// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import {
  ChevronDown,
  FileDown,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { isAbortError } from "@/lib/abort-error";
import {
  decodeBase64Bytes,
  exportAstrocartPdf,
  exportAstrocartPdfBytes,
  fetchAstrocartConfiguration,
  fetchOptions,
  patchOptions,
  setAstrocartLayerOptions,
  storeAstrocartConfiguration,
  workspaceClose,
  workspaceOpen,
  type AstrocartAngleKind,
  type AstrocartConfigurationPayload,
  type AstrocartDynamicLayer,
  type AstrocartDynamicTechnique,
  type AstrocartLineMode,
  type AstrocartMapSpec,
  type AstrocartPdfPageFormat,
  type AstrocartPdfScope,
  type AstrocartPdfSelection,
  type AstrocartPrintAtlas,
  type AstrocartPointRecord,
  type OptionsDisplay,
  type OptionsPayload,
} from "@/lib/daemon/client";
import { useLocale, useT, useTFallback } from "@/lib/i18n/i18n";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { resolveShellHost } from "@/lib/shell-host";
import { cn } from "@/lib/utils";
import { runImmediateWorkspaceCommand } from "@/stores/daemon-workspace-adapter";

const ANGULAR_LINE_ROLE = "angular_line_source";
const PARAN_ROLE = "paran_participant";
const ASPECT_ROLE = "aspect_to_angle_source";

const PDF_LINE_KIND_ORDER = [
  "MC",
  "IC",
  "ASC",
  "DSC",
  "PARAN",
  "ASPECT",
  "LOCAL_SPACE",
  "LOCAL_SPACE_OPPOSITION",
  "ZENITH",
] as const;

type AstrocartPdfLayerKind = AstrocartPdfSelection["layerKinds"][number];

const DYNAMIC_ROLE_BY_TECHNIQUE: Record<AstrocartDynamicTechnique, string> = {
  transit: "transit_actor",
  secondary_progression: "secondary_progression_actor",
  minor_progression: "minor_progression_actor",
  tertiary_progression: "tertiary_progression_actor",
  solar_arc: "solar_arc_actor",
  lewis_ccg: "transit_actor",
};
const DYNAMIC_TECHNIQUE_IDS = [
  "transit",
  "secondary_progression",
  "minor_progression",
  "tertiary_progression",
  "solar_arc",
  "lewis_ccg",
] as const satisfies readonly AstrocartDynamicTechnique[];
const SPEC_SAVE_DEBOUNCE_MS = 180;
/** Drawer layers open as real child tabs, exactly like sidebar launches. */
const LAYER_TAB_FEATURE_KIND: Record<AstrocartDynamicTechnique, string> = {
  transit: "transits",
  secondary_progression: "secondary-progression",
  minor_progression: "minor-progression",
  tertiary_progression: "tertiary-progression",
  solar_arc: "solar-arc",
  // Lewis CCG steps with secondary-progression increments; the tab only
  // supplies the real-date cursor, the map computes the recipe itself.
  lewis_ccg: "secondary-progression",
};

/** Lewis CCG draws both roles: progressed Sun-Mars and transiting others. */
export function dynamicLayerDrawsTransits(layer: Pick<AstrocartDynamicLayer, "technique">): boolean {
  return layer.technique === "transit" || layer.technique === "lewis_ccg";
}

export function dynamicLayerDrawsProgressions(layer: Pick<AstrocartDynamicLayer, "technique">): boolean {
  return layer.technique !== "transit";
}

export type AstrocartConfigurationChange = {
  payload: AstrocartConfigurationPayload;
  geometryChanged: boolean;
};

export type AstrocartParanIntent = {
  revision: number;
  enabled: boolean;
};

function copySpec(spec: AstrocartMapSpec): AstrocartMapSpec {
  return JSON.parse(JSON.stringify(spec)) as AstrocartMapSpec;
}

function specsMatch(left: AstrocartMapSpec | null, right: AstrocartMapSpec | null): boolean {
  return left != null && right != null && JSON.stringify(left) === JSON.stringify(right);
}

function inputDateTimeValue(value: string | null): string {
  if (!value) return "";
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) {
      const local = new Date(
        instant.getTime() - instant.getTimezoneOffset() * 60_000,
      );
      return local.toISOString().slice(0, 16);
    }
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match?.[1] ?? "";
}

function localDateTimeInstant(value: string): string | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function newDynamicCursor(
  configuration: AstrocartConfigurationPayload,
  technique: AstrocartDynamicTechnique,
): string {
  return (technique === "transit" || technique === "lewis_ccg"
    ? configuration.defaultTransitCursorIso
    : null)
    ?? new Date().toISOString();
}

function toggleId(values: string[], id: string, selected: boolean): string[] {
  const next = new Set(values);
  if (selected) next.add(id);
  else next.delete(id);
  return [...next].sort();
}

function toggleAngle(
  values: AstrocartAngleKind[],
  angle: AstrocartAngleKind,
  selected: boolean,
  order: AstrocartAngleKind[],
): AstrocartAngleKind[] {
  const next = new Set(values);
  if (selected) next.add(angle);
  else next.delete(angle);
  return order.filter((item) => next.has(item));
}

function activateAngularLinePoints(
  configuration: AstrocartConfigurationPayload,
  current: AstrocartMapSpec,
  selectedIds: string[],
): AstrocartMapSpec {
  const previouslySelected = new Set(current.staticAngleLinePointIds);
  const paranCapable = paranCapableIds(configuration);
  const participantIds = new Set(current.paran.participantIds);
  for (const pointId of selectedIds) {
    if (!previouslySelected.has(pointId) && paranCapable.has(pointId)) {
      participantIds.add(pointId);
    }
  }
  return {
    ...current,
    staticAngleLinePointIds: selectedIds,
    dynamicLayers: current.dynamicLayers.map((layer) => ({
      ...layer,
      movingActorIds: layer.sourceDocumentId ? layer.movingActorIds : supportedDynamicActorIds(
        configuration,
        layer.technique,
        selectedIds,
      ),
    })),
    paran: {
      ...current.paran,
      participantIds: current.paran.followLines
        ? supportedParanLineIds(configuration, selectedIds)
        : [...participantIds].sort(),
    },
  };
}

function paranCapableIds(configuration: AstrocartConfigurationPayload): Set<string> {
  return new Set(configuration.catalog.points
    .filter((point) => point.capabilities[PARAN_ROLE]?.status === "supported")
    .map((point) => point.semanticId));
}

function supportedParanLineIds(
  configuration: AstrocartConfigurationPayload,
  lineIds: readonly string[],
): string[] {
  const capable = paranCapableIds(configuration);
  return [...new Set(lineIds)].filter((pointId) => capable.has(pointId)).sort();
}

function supportedDynamicActorIds(
  configuration: AstrocartConfigurationPayload,
  technique: AstrocartDynamicTechnique,
  candidateIds: readonly string[],
): string[] {
  const role = DYNAMIC_ROLE_BY_TECHNIQUE[technique];
  const candidates = new Set(candidateIds);
  return configuration.catalog.points
    .filter((point) => (
      candidates.has(point.semanticId) &&
      point.capabilities[role]?.status === "supported"
    ))
    .map((point) => point.semanticId);
}

function defaultDynamicActorIds(
  configuration: AstrocartConfigurationPayload,
  technique: AstrocartDynamicTechnique,
  natalPointIds: readonly string[],
): string[] {
  // The selected map points are the source for every timing technique;
  // the catalog's capability matrix narrows unsupported combinations.
  return supportedDynamicActorIds(configuration, technique, natalPointIds);
}

function dynamicActorIdsForTechnique(
  configuration: AstrocartConfigurationPayload,
  technique: AstrocartDynamicTechnique,
  natalPointIds: readonly string[],
): string[] {
  return defaultDynamicActorIds(configuration, technique, natalPointIds);
}

function appliedPdfPointIds(spec: AstrocartMapSpec): string[] {
  const ids = new Set(spec.staticAngleLinePointIds);
  if (spec.paran.enabled) {
    for (const pointId of spec.paran.participantIds) ids.add(pointId);
  }
  if (spec.aspects.definitions.some((definition) => definition.enabled)) {
    for (const pointId of spec.aspects.actorIds) ids.add(pointId);
  }
  for (const layer of spec.dynamicLayers) {
    if (!layer.enabled) continue;
    for (const pointId of layer.movingActorIds) ids.add(pointId);
  }
  return [...ids].sort();
}

function appliedPdfLineKinds(spec: AstrocartMapSpec): string[] {
  const kinds = new Set<string>(spec.selectedAngleKinds);
  if (spec.paran.enabled) kinds.add("PARAN");
  if (spec.aspects.definitions.some((definition) => definition.enabled)) {
    kinds.add("ASPECT");
  }
  kinds.add("LOCAL_SPACE");
  if (spec.localSpace.oppositionEnabled) kinds.add("LOCAL_SPACE_OPPOSITION");
  if (spec.zenithEnabled) kinds.add("ZENITH");
  return PDF_LINE_KIND_ORDER.filter((kind) => kinds.has(kind));
}

function appliedPdfLayerKinds(spec: AstrocartMapSpec): AstrocartPdfLayerKind[] {
  const layers = new Set<AstrocartPdfLayerKind>(["natal"]);
  for (const layer of spec.dynamicLayers) {
    if (!layer.enabled) continue;
    if (dynamicLayerDrawsTransits(layer)) layers.add("transit");
    if (dynamicLayerDrawsProgressions(layer)) layers.add("progression");
  }
  return (["natal", "transit", "progression"] as const)
    .filter((layer) => layers.has(layer));
}

function defaultPdfSelection(
  spec: AstrocartMapSpec,
  natalLayerVisible: boolean,
): AstrocartPdfSelection {
  return {
    pointIds: appliedPdfPointIds(spec),
    lineKinds: appliedPdfLineKinds(spec),
    layerKinds: appliedPdfLayerKinds(spec).filter(
      (layer) => layer !== "natal" || natalLayerVisible,
    ),
    aspectIds: spec.aspects.definitions
      .filter((definition) => definition.enabled)
      .map((definition) => definition.id)
      .sort(),
    includeZenith: spec.zenithEnabled,
  };
}

export function AstrocartControls({
  chartTitle,
  documentId,
  active,
  visible,
  catalogRevision,
  optionsRevision,
  paranIntent,
  lineModes,
  natalLayerVisible,
  dynamicLayerVisible,
  hiddenLayerIds,
  linkedCursorIsoByDocumentId,
  selectedLayerDocumentId,
  mapViewReady,
  distanceUnits,
  distanceUnitsFailed,
  onDistanceUnitsChange,
  onClose,
  onMapViewReset,
  onPreviewChange,
  onCanonicalChange,
  onNatalLayerVisibilityChange,
  onDynamicLayerVisibilityChange,
  onLinkedLayerVisibilityChange,
  onStandardViewReset,
  onRequestPrintAtlas,
}: {
  chartTitle: string;
  documentId: string;
  active: boolean;
  visible: boolean;
  catalogRevision: number | string;
  optionsRevision: number;
  paranIntent: AstrocartParanIntent | null;
  lineModes: AstrocartLineMode[];
  natalLayerVisible: boolean;
  dynamicLayerVisible: boolean;
  hiddenLayerIds: string[];
  linkedCursorIsoByDocumentId: Record<string, string>;
  selectedLayerDocumentId: string | null;
  mapViewReady: boolean;
  distanceUnits: "metric" | "miles";
  distanceUnitsFailed: boolean;
  onDistanceUnitsChange: (units: "metric" | "miles") => void;
  onClose: () => void;
  onMapViewReset: () => void;
  onPreviewChange: (spec: AstrocartMapSpec) => void;
  onCanonicalChange: (change: AstrocartConfigurationChange) => void;
  onNatalLayerVisibilityChange: (visible: boolean) => void;
  onDynamicLayerVisibilityChange: (visible: boolean) => void;
  onLinkedLayerVisibilityChange: (sourceDocumentId: string, visible: boolean) => void;
  onStandardViewReset: () => void;
  onRequestPrintAtlas: (
    pageFormat: AstrocartPdfPageFormat,
    selection: AstrocartPdfSelection,
    signal: AbortSignal,
    scope: AstrocartPdfScope,
  ) => Promise<AstrocartPrintAtlas | null>;
}) {
  const t = useT();
  const tf = useTFallback();
  const locale = useLocale();
  const [configuration, setConfiguration] =
    React.useState<AstrocartConfigurationPayload | null>(null);
  const [draft, setDraft] = React.useState<AstrocartMapSpec | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [appearanceOptions, setAppearanceOptions] =
    React.useState<OptionsPayload | null>(null);
  const [appearanceSaving, setAppearanceSaving] = React.useState(false);
  const [appearanceFailed, setAppearanceFailed] = React.useState(false);
  const [pdfPageFormat, setPdfPageFormat] =
    React.useState<AstrocartPdfPageFormat>("A4");
  const [pdfScope, setPdfScope] = React.useState<AstrocartPdfScope>("world");
  const [exportingPdf, setExportingPdf] = React.useState(false);
  const [pdfExportFailed, setPdfExportFailed] = React.useState(false);
  const [dynamicLayerKeys, setDynamicLayerKeys] = React.useState<string[]>([]);
  const [completedConfigurationKey, setCompletedConfigurationKey] =
    React.useState<string | null>(null);
  const saveRequestRef = React.useRef<AbortController | null>(null);
  const saveTimerRef = React.useRef<number | null>(null);
  const pendingSaveRef = React.useRef<AstrocartMapSpec | null>(null);
  const activeSaveSpecRef = React.useRef<AstrocartMapSpec | null>(null);
  const pendingStandardViewResetDocumentRef = React.useRef<string | null>(null);
  const saveLoopRunningRef = React.useRef(false);
  const exportRequestRef = React.useRef<AbortController | null>(null);
  const appearanceRequestRef = React.useRef<AbortController | null>(null);
  const appearanceOptionsRef = React.useRef(appearanceOptions);
  const pendingAppearancePatchRef =
    React.useRef<Partial<OptionsDisplay> | null>(null);
  const appearancePatchLoopRunningRef = React.useRef(false);
  const loadedAppearanceRevisionRef = React.useRef<number | null>(null);
  const configurationRef = React.useRef(configuration);
  const draftRef = React.useRef(draft);
  const dynamicLayerKeySequenceRef = React.useRef(0);
  const loadedConfigurationKeyRef = React.useRef<string | null>(null);
  const appliedParanIntentRevisionRef = React.useRef(0);
  const dirty = !specsMatch(configuration?.spec ?? null, draft);
  const configurationRequestKey = `${documentId}:${catalogRevision}`;
  const configurationReady =
    completedConfigurationKey === configurationRequestKey;

  React.useEffect(() => {
    configurationRef.current = configuration;
    draftRef.current = draft;
  }, [configuration, draft]);

  React.useEffect(() => {
    appearanceOptionsRef.current = appearanceOptions;
  }, [appearanceOptions]);

  React.useEffect(() => {
    if (!active || !visible) {
      appearanceRequestRef.current?.abort();
      appearanceRequestRef.current = null;
      loadedAppearanceRevisionRef.current = null;
      return;
    }
    if (appearancePatchLoopRunningRef.current) {
      // The options.changed event from our own partial patch can arrive before
      // its full response. That response is already the authoritative
      // reconciliation, so do not add a duplicate GET to the hot toggle path.
      loadedAppearanceRevisionRef.current = optionsRevision;
      return;
    }
    if (
      loadedAppearanceRevisionRef.current === optionsRevision &&
      appearanceOptionsRef.current
    ) {
      return;
    }
    loadedAppearanceRevisionRef.current = optionsRevision;
    appearanceRequestRef.current?.abort();
    const controller = new AbortController();
    appearanceRequestRef.current = controller;
    fetchOptions(controller.signal)
      .then((payload) => {
        if (
          controller.signal.aborted ||
          appearancePatchLoopRunningRef.current ||
          pendingAppearancePatchRef.current
        ) {
          return;
        }
        appearanceOptionsRef.current = payload;
        setAppearanceOptions(payload);
        setAppearanceFailed(false);
      })
      .catch((error) => {
        if (isAbortError(error, controller.signal)) return;
        loadedAppearanceRevisionRef.current = null;
        setAppearanceFailed(true);
      })
      .finally(() => {
        if (appearanceRequestRef.current === controller) {
          appearanceRequestRef.current = null;
        }
      });
    return () => controller.abort();
  }, [active, optionsRevision, visible]);

  const reconcileDynamicLayerKeys = React.useCallback((
    current: string[],
    count: number,
  ): string[] => {
    const next = current.slice(0, count);
    while (next.length < count) {
      dynamicLayerKeySequenceRef.current += 1;
      next.push(`${documentId}:dynamic:${dynamicLayerKeySequenceRef.current}`);
    }
    return next;
  }, [documentId]);

  React.useEffect(() => {
    if (!active) {
      // Static ACG preferences are global. A retained inspector must quietly
      // refresh on its next activation so changes made in another map are not
      // overwritten by this document's older canonical draft.
      loadedConfigurationKeyRef.current = null;
      queueMicrotask(() => setCompletedConfigurationKey(null));
      return;
    }
    const requestKey = configurationRequestKey;
    if (loadedConfigurationKeyRef.current === requestKey) return;
    const previousKey = loadedConfigurationKeyRef.current;
    const documentChanged =
      previousKey != null && !previousKey.startsWith(`${documentId}:`);
    loadedConfigurationKeyRef.current = requestKey;
    const controller = new AbortController();
    let completed = false;
    fetchAstrocartConfiguration(documentId, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        completed = true;
        setCompletedConfigurationKey(requestKey);
        const hasLocalSaveIntent =
          pendingSaveRef.current != null ||
          activeSaveSpecRef.current != null;
        const preserveDirtyDraft =
          !documentChanged &&
          configurationRef.current != null &&
          draftRef.current != null &&
          (
            hasLocalSaveIntent ||
            !specsMatch(configurationRef.current.spec, draftRef.current)
          );
        if (preserveDirtyDraft) {
          setFailed(false);
          return;
        }
        configurationRef.current = payload;
        setConfiguration(payload);
        const nextDraft = copySpec(payload.spec);
        draftRef.current = nextDraft;
        setDraft(nextDraft);
        setDynamicLayerKeys((current) => reconcileDynamicLayerKeys(
          current,
          nextDraft.dynamicLayers.length,
        ));
        setFailed(false);
        onCanonicalChange({ payload, geometryChanged: false });
      })
      .catch((error) => {
        if (isAbortError(error, controller.signal)) return;
        if (loadedConfigurationKeyRef.current === requestKey) {
          loadedConfigurationKeyRef.current = null;
        }
        setCompletedConfigurationKey((current) =>
          current === requestKey ? null : current
        );
        setFailed(true);
      });
    return () => {
      controller.abort();
      if (!completed && loadedConfigurationKeyRef.current === requestKey) {
        loadedConfigurationKeyRef.current = null;
      }
    };
  }, [
    active,
    catalogRevision,
    configurationRequestKey,
    documentId,
    onCanonicalChange,
    reconcileDynamicLayerKeys,
  ]);

  React.useEffect(() => () => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveRequestRef.current?.abort();
    exportRequestRef.current?.abort();
    appearanceRequestRef.current?.abort();
  }, []);

  const flushAppearancePatches = React.useCallback(async () => {
    if (appearancePatchLoopRunningRef.current) return;
    appearancePatchLoopRunningRef.current = true;
    setAppearanceSaving(true);
    setAppearanceFailed(false);
    try {
      while (pendingAppearancePatchRef.current) {
        const submittedPatch = pendingAppearancePatchRef.current;
        pendingAppearancePatchRef.current = null;
        let payload: OptionsPayload;
        try {
          payload = await patchOptions({ display: submittedPatch });
        } catch {
          pendingAppearancePatchRef.current = null;
          setAppearanceFailed(true);
          loadedAppearanceRevisionRef.current = null;
          try {
            const canonical = await fetchOptions();
            appearanceOptionsRef.current = canonical;
            setAppearanceOptions(canonical);
            setAppearanceFailed(false);
          } catch {
            // Keep the optimistic controls visible with the failure affordance;
            // the next inspector activation retries the canonical fetch.
          }
          return;
        }
        const newerPatch = pendingAppearancePatchRef.current;
        const reconciled: OptionsPayload = {
          ...payload,
          display: {
            ...payload.display,
            ...(newerPatch ?? {}),
          },
        };
        appearanceOptionsRef.current = reconciled;
        setAppearanceOptions(reconciled);
      }
    } finally {
      appearancePatchLoopRunningRef.current = false;
      setAppearanceSaving(false);
    }
  }, []);

  const updateAppearanceOption = React.useCallback(<K extends keyof OptionsDisplay>(
    field: K,
    value: OptionsDisplay[K],
  ) => {
    const current = appearanceOptionsRef.current;
    if (!current) return;
    const patch = { [field]: value } as Partial<OptionsDisplay>;
    const optimistic = {
      ...current,
      display: { ...current.display, ...patch },
    };
    appearanceOptionsRef.current = optimistic;
    setAppearanceOptions(optimistic);
    pendingAppearancePatchRef.current = {
      ...(pendingAppearancePatchRef.current ?? {}),
      ...patch,
    };
    void flushAppearancePatches();
  }, [flushAppearancePatches]);

  const flushPendingSaves = React.useCallback(async () => {
    if (saveLoopRunningRef.current) return;
    saveLoopRunningRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      while (pendingSaveRef.current) {
        const submittedSpec = pendingSaveRef.current;
        pendingSaveRef.current = null;
        const previousSpecKey = configurationRef.current?.specKey ?? null;
        const controller = new AbortController();
        saveRequestRef.current = controller;
        activeSaveSpecRef.current = submittedSpec;
        let payload: AstrocartConfigurationPayload;
        try {
          payload = await storeAstrocartConfiguration(
            documentId,
            submittedSpec,
            controller.signal,
          );
        } catch (error) {
          if (isAbortError(error, controller.signal)) return;
          setFailed(true);
          return;
        } finally {
          if (saveRequestRef.current === controller) {
            saveRequestRef.current = null;
          }
          if (activeSaveSpecRef.current === submittedSpec) {
            activeSaveSpecRef.current = null;
          }
        }
        if (controller.signal.aborted) return;

        const currentDraft = draftRef.current;
        const hasNewerDraft =
          pendingSaveRef.current != null ||
          (currentDraft != null && !specsMatch(currentDraft, submittedSpec));
        if (hasNewerDraft) continue;

        configurationRef.current = payload;
        setConfiguration(payload);
        const normalizedDraft = copySpec(payload.spec);
        draftRef.current = normalizedDraft;
        setDraft(normalizedDraft);
        setDynamicLayerKeys((current) => reconcileDynamicLayerKeys(
          current,
          normalizedDraft.dynamicLayers.length,
        ));
        const completeStandardViewReset =
          pendingStandardViewResetDocumentRef.current === documentId;
        onCanonicalChange({
          payload,
          geometryChanged: previousSpecKey !== payload.specKey,
        });
        if (completeStandardViewReset) {
          pendingStandardViewResetDocumentRef.current = null;
          onStandardViewReset();
        }
      }
    } finally {
      saveLoopRunningRef.current = false;
      setSaving(false);
    }
  }, [
    documentId,
    onCanonicalChange,
    onStandardViewReset,
    reconcileDynamicLayerKeys,
  ]);

  const openLayerTab = React.useCallback((technique: AstrocartDynamicTechnique) => {
    void runImmediateWorkspaceCommand(workspaceOpen({
      parentDocumentId: documentId,
      featureKind: LAYER_TAB_FEATURE_KIND[technique],
      reuseExisting: true,
      astrocartTechnique: technique === "lewis_ccg" ? "lewis_ccg" : null,
    })).catch((error) => console.error("[astrocart-layer-tab]", error));
  }, [documentId]);

  const closeLayerTab = React.useCallback((layerDocumentId: string) => {
    void runImmediateWorkspaceCommand(workspaceClose(layerDocumentId, true), layerDocumentId)
      .catch((error) => console.error("[astrocart-layer-tab-close]", error));
  }, []);

  const setLayerTabProgressedAngles = React.useCallback(async (
    layerDocumentId: string,
    progressedAnglesRa: boolean,
  ) => {
    let payload: AstrocartConfigurationPayload;
    try {
      payload = await setAstrocartLayerOptions(layerDocumentId, { progressedAnglesRa });
    } catch (error) {
      console.error("[astrocart-layer-options]", error);
      setFailed(true);
      return;
    }
    configurationRef.current = payload;
    setConfiguration(payload);
    if (pendingSaveRef.current == null && !saveLoopRunningRef.current) {
      const normalizedDraft = copySpec(payload.spec);
      draftRef.current = normalizedDraft;
      setDraft(normalizedDraft);
      setDynamicLayerKeys((current) => reconcileDynamicLayerKeys(
        current,
        normalizedDraft.dynamicLayers.length,
      ));
    }
    onCanonicalChange({ payload, geometryChanged: true });
  }, [onCanonicalChange, reconcileDynamicLayerKeys]);

  const queueSpecSave = React.useCallback((
    spec: AstrocartMapSpec,
    immediate = false,
  ) => {
    pendingSaveRef.current = spec;
    setFailed(false);
    if (saveLoopRunningRef.current) return;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (immediate) {
      void flushPendingSaves();
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushPendingSaves();
    }, SPEC_SAVE_DEBOUNCE_MS);
  }, [flushPendingSaves]);

  const updateDraft = React.useCallback((
    update: (current: AstrocartMapSpec) => AstrocartMapSpec,
    immediate = false,
  ) => {
    const current = draftRef.current;
    if (!current) return;
    const next = update(current);
    if (specsMatch(current, next)) return;
    draftRef.current = next;
    setDraft(next);
    onPreviewChange(next);
    queueSpecSave(next, immediate);
  }, [onPreviewChange, queueSpecSave]);

  React.useEffect(() => {
    if (
      paranIntent == null ||
      appliedParanIntentRevisionRef.current >= paranIntent.revision
    ) {
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    appliedParanIntentRevisionRef.current = paranIntent.revision;
    updateDraft((spec) => ({
      ...spec,
      paran: {
        ...spec.paran,
        enabled: paranIntent.enabled,
      },
    }), true);
  }, [draft, paranIntent, updateDraft]);

  const resetToStandardView = React.useCallback(() => {
    const standardSpec = configurationRef.current?.defaultSpec;
    const current = draftRef.current;
    if (!standardSpec || !current) return;
    const next = copySpec(standardSpec);
    setDynamicLayerKeys((keys) => reconcileDynamicLayerKeys(
      keys,
      next.dynamicLayers.length,
    ));
    if (!specsMatch(current, next)) {
      draftRef.current = next;
      setDraft(next);
      onPreviewChange(next);
    }
    const activeSaveIsStandard = specsMatch(activeSaveSpecRef.current, next);
    if (activeSaveIsStandard) {
      pendingSaveRef.current = null;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingStandardViewResetDocumentRef.current = documentId;
      setFailed(false);
      return;
    }
    if (!saveLoopRunningRef.current && saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
    }
    if (
      specsMatch(configurationRef.current?.spec ?? null, next) &&
      !saveLoopRunningRef.current
    ) {
      pendingStandardViewResetDocumentRef.current = null;
      setFailed(false);
      onStandardViewReset();
      return;
    }
    pendingStandardViewResetDocumentRef.current = documentId;
    queueSpecSave(next, true);
  }, [
    documentId,
    onPreviewChange,
    onStandardViewReset,
    queueSpecSave,
    reconcileDynamicLayerKeys,
  ]);

  const retrySave = React.useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    pendingSaveRef.current = current;
    setFailed(false);
    void flushPendingSaves();
  }, [flushPendingSaves]);

  const exportPdf = React.useCallback(async () => {
    if (
      !configuration ||
      dirty ||
      exportingPdf ||
      (lineModes.length === 0 && !configuration.spec.paran.enabled &&
        !configuration.spec.dynamicLayers.some((layer) => layer.enabled))
    ) return;

    const pdfSelection = defaultPdfSelection(configuration.spec, natalLayerVisible);
    const pointLabels: Record<string, string> = {};
    for (const point of configuration.catalog.points) {
      const label = point.labelKey ? tf(point.labelKey, point.label) : point.label;
      pointLabels[point.semanticId] = label;
      if (point.point?.id) pointLabels[point.point.id] = label;
    }
    const aspectLabels = Object.fromEntries(
      configuration.aspects.map((aspect) => [
        aspect.id,
        tf(aspect.labelKey, aspect.id),
      ]),
    );
    const localizedLabels = {
      client: t("astrocart.pdf.client"),
      date: t("astrocart.pdf.date"),
      selection: t("astrocart.pdf.included"),
      legend: t("astrocart.pdf.legend"),
      points: pointLabels,
      kinds: {
        MC: "MC",
        IC: "IC",
        ASC: "ASC",
        DSC: "DSC",
        PARAN: t("astrocart.pdf.lineKind.paran"),
        ASPECT: t("astrocart.pdf.lineKind.aspect"),
        LOCAL_SPACE: t("astrocart.pdf.lineKind.localSpace"),
        LOCAL_SPACE_OPPOSITION: t("astrocart.pdf.lineKind.localSpaceOpposition"),
        ZENITH: t("astrocart.pdf.lineKind.zenith"),
      },
      layers: {
        natal: t("astrocart.overlay.natalLayer"),
        transit: t("astrocart.overlay.transitLayer"),
        progression: t("astrocart.overlay.progressionLayer"),
      },
      techniques: Object.fromEntries(
        DYNAMIC_TECHNIQUE_IDS.map((technique) => [
          technique,
          t(`astrocart.dynamic.${technique}`),
        ]),
      ),
      aspects: aspectLabels,
    };
    const controller = new AbortController();
    exportRequestRef.current = controller;
    const filename = `${Array.from(chartTitle, (char) =>
      /[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 32 ? "-" : char,
    ).join("").trim().replace(/[. ]+$/, "").slice(0, 180)}.pdf`;
    const host = resolveShellHost();
    setExportingPdf(true);
    setPdfExportFailed(false);
    try {
      const path = host.capabilities.nativeFileDialogs
        ? await host.selectSavePath({
            title: t("astrocart.pdf.saveDialogTitle"),
            defaultPath: filename,
            filters: [{
              name: t("astrocart.pdf.pdfFiles"),
              extensions: ["pdf"],
            }],
          })
        : null;
      if (host.capabilities.nativeFileDialogs && !path) return;
      const atlas = await onRequestPrintAtlas(
        pdfPageFormat,
        pdfSelection,
        controller.signal,
        pdfScope,
      );
      if (!atlas) throw new Error("astrocart atlas capture unavailable");
      const commonOptions = {
        modes: [...lineModes],
        expectedSpecKey: configuration.specKey,
        selection: pdfSelection,
        pageFormat: pdfPageFormat,
        locale,
        title: chartTitle,
        subtitle: t("astrocart.pdf.subtitle", {
          coordinate: t(`astrocart.coordinate.${configuration.spec.coordinateSystem}`),
        }),
        chartDate: "",
        selectionSummary: "",
        localizedLabels,
        atlas,
      };
      if (host.capabilities.nativeFileDialogs) {
        await exportAstrocartPdf(
          documentId,
          { ...commonOptions, path: path! },
          controller.signal,
        );
      } else {
        const result = await exportAstrocartPdfBytes(
          documentId,
          { ...commonOptions, filename },
          controller.signal,
        );
        await host.downloadBytes(
          result.filename,
          decodeBase64Bytes(result.dataBase64),
          result.mimeType,
        );
      }
    } catch (error) {
      if (!isAbortError(error, exportRequestRef.current?.signal)) {
        console.error("[acg-pdf] export failed", error);
        setPdfExportFailed(true);
      }
    } finally {
      exportRequestRef.current = null;
      setExportingPdf(false);
    }
  }, [
    chartTitle,
    configuration,
    dirty,
    documentId,
    exportingPdf,
    lineModes,
    locale,
    pdfPageFormat,
    pdfScope,
    natalLayerVisible,
    onRequestPrintAtlas,
    t,
    tf,
  ]);

  return (
    <div
      className={LIST_PANE_CLASSES.root}
      aria-busy={!configurationReady || !draft || saving || appearanceSaving}
      data-astrocart-controls-pane=""
    >
      <header className={LIST_PANE_CLASSES.compactHeader}>
        <div className={LIST_PANE_CLASSES.titleGroup}>
          <h2 className={LIST_PANE_CLASSES.title}>
            {t("astrocart.config.title")}
          </h2>
          {saving || appearanceSaving ? (
            <LoaderCircle
              aria-label={t("astrocart.config.applying")}
              className="size-3.5 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.icon}
            disabled={!mapViewReady}
            onClick={onMapViewReset}
            aria-label={t("astrocart.config.resetMapView")}
            title={t("astrocart.config.resetMapView")}
          >
            <RotateCcw aria-hidden />
          </Button>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.icon}
            onClick={onClose}
            aria-label={t("astrocart.config.close")}
            title={t("astrocart.config.close")}
          >
            <X aria-hidden />
          </Button>
        </div>
      </header>

      <div className={LIST_PANE_CLASSES.scroller}>
        {(!draft || !configuration) && !failed ? (
          <div className={cn(LIST_PANE_CLASSES.loading, "flex items-center gap-2")}>
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {t("astrocart.config.loading")}
          </div>
        ) : draft && configuration ? (
          <div className="flex flex-col">
            <ConfigSection sectionId="layers" title={t("astrocart.pdf.layers")} defaultOpen>
              <div className="grid grid-cols-2 gap-x-3">
                <ToggleRow
                  dense
                  checked={natalLayerVisible}
                  label={t("astrocart.overlay.natalLayer")}
                  onChange={onNatalLayerVisibilityChange}
                />
                <ToggleRow
                  dense
                  checked={dynamicLayerVisible && draft.dynamicLayers.some((layer) => layer.enabled)}
                  label={t("astrocart.config.dynamicLayers")}
                  onChange={(visible) => {
                    if (visible && draft.dynamicLayers.length === 0) {
                      openLayerTab("transit");
                    } else if (visible && !draft.dynamicLayers.some((layer) => layer.enabled)) {
                      updateDraft((current) => {
                        if (current.dynamicLayers.length) {
                          return {
                            ...current,
                            dynamicLayers: current.dynamicLayers.map((layer, index) =>
                              index === 0 ? {
                                ...layer,
                                enabled: true,
                                cursorIso: layer.cursorIso ?? newDynamicCursor(configuration, layer.technique),
                              } : layer
                            ),
                          };
                        }
                        const technique = configuration.dynamicTechniques[0]?.id ?? "transit";
                        setDynamicLayerKeys((keys) => reconcileDynamicLayerKeys(keys, 1));
                        return {
                          ...current,
                          dynamicLayers: [{
                            technique,
                            labelKey: `astrocart.dynamic.${technique}`,
                            cursorIso: newDynamicCursor(configuration, technique),
                            movingActorIds: defaultDynamicActorIds(
                              configuration,
                              technique,
                              current.staticAngleLinePointIds,
                            ),
                            enabled: true,
                          }],
                        };
                      });
                    }
                    onDynamicLayerVisibilityChange(visible);
                  }}
                />
              </div>
            </ConfigSection>

            <ConfigSection sectionId="appearance" title={t("appearance.title")}>
              <SegmentedSetting
                label={t("astrocart.config.coordinates")}
                value={draft.coordinateSystem}
                options={configuration.coordinateSystems.map((coordinateSystem) => ({
                  value: coordinateSystem,
                  label: t(`astrocart.coordinate.${coordinateSystem}`),
                }))}
                onChange={(coordinateSystem) => updateDraft((current) => ({
                  ...current,
                  coordinateSystem,
                }))}
              />
              <SegmentedSetting
                label={t("astrocart.ruler.units")}
                value={distanceUnits}
                disabled={!mapViewReady}
                options={(["metric", "miles"] as const).map((units) => ({
                  value: units,
                  label: t(`astrocart.ruler.${units}`),
                }))}
                onChange={onDistanceUnitsChange}
              />
              {distanceUnitsFailed ? (
                <p role="alert" className="text-xs text-destructive">{t("astrocart.config.saveFailed")}</p>
              ) : null}
              <SegmentedSetting
                label={t("astrocart.config.lineWeight")}
                value={appearanceOptions?.display.astrocart_line_weight ?? "thin"}
                disabled={!appearanceOptions}
                options={(["thin", "medium", "bold"] as const).map((weight) => ({
                  value: weight,
                  label: t(`astrocart.config.lineWeight.${weight}`),
                }))}
                onChange={(weight) => updateAppearanceOption("astrocart_line_weight", weight)}
              />
              <SegmentedSetting
                label={t("astrocart.config.lineLabels")}
                value={appearanceOptions?.display.astrocart_line_labels ?? "names"}
                disabled={!appearanceOptions}
                options={(["names", "glyphs"] as const).map((labels) => ({
                  value: labels,
                  label: t(`astrocart.config.lineLabels.${labels}`),
                }))}
                onChange={(labels) => updateAppearanceOption("astrocart_line_labels", labels)}
              />
              <ToggleRow
                checked={appearanceOptions?.display.astrocart_local_space_bearings ?? false}
                disabled={!appearanceOptions}
                label={t("astrocart.config.localSpaceBearings")}
                onChange={(shown) => updateAppearanceOption("astrocart_local_space_bearings", shown)}
              />
              <div className="px-1 text-[length:var(--aries-font-size-small)] text-muted-foreground">
                {t("astrocart.config.mapPoints")}
              </div>
              <ToggleRow
                checked={draft.zenithEnabled}
                label={t("astrocart.config.zenithPoints")}
                onChange={(zenithEnabled) => updateDraft((current) => ({
                  ...current,
                  zenithEnabled,
                }))}
              />
              <ToggleRow
                checked={draft.localSpace.oppositionEnabled}
                label={t("astrocart.config.localSpaceOppositions")}
                onChange={(oppositionEnabled) => updateDraft((current) => ({
                  ...current,
                  localSpace: { ...current.localSpace, oppositionEnabled },
                }))}
              />
              {appearanceOptions?.settingsRegistry.mirroredSections
                .find((section) => section.tabId === "astrocartography")
                ?.settings.map((setting) => (
                  <ToggleRow
                    key={setting.id}
                    checked={Boolean(appearanceOptions.display[setting.field])}
                    label={t(setting.labelKey)}
                    onChange={(checked) => updateAppearanceOption(
                      setting.field,
                      checked,
                    )}
                  />
                ))}
              {!appearanceOptions && !appearanceFailed ? (
                <div className={cn(
                  LIST_PANE_CLASSES.loading,
                  "flex items-center gap-2 px-1 py-1",
                )}>
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                  {t("astrocart.config.loading")}
                </div>
              ) : null}
              {appearanceFailed ? (
                <p className="px-1 text-[length:var(--aries-font-size-small)] text-destructive">
                  {t("astrocart.config.saveFailed")}
                </p>
              ) : null}
            </ConfigSection>

            <ConfigSection sectionId="angularLines" title={t("astrocart.config.lines")} defaultOpen>
              <AnglePicker
                title={t("astrocart.config.angleKinds")}
                angles={configuration.angleKinds}
                selected={draft.selectedAngleKinds}
                onChange={(angle, checked) => updateDraft((current) => ({
                  ...current,
                  selectedAngleKinds: toggleAngle(
                    current.selectedAngleKinds,
                    angle,
                    checked,
                    configuration.angleKinds,
                  ),
                }))}
              />
              <PointPicker
                catalog={configuration}
                role={ANGULAR_LINE_ROLE}
                selectedIds={draft.staticAngleLinePointIds}
                onResetToStandardView={resetToStandardView}
                resetDisabled={
                  specsMatch(draft, configuration.defaultSpec) &&
                  specsMatch(configuration.spec, configuration.defaultSpec) &&
                  lineModes.length === 1 &&
                  lineModes[0] === "standard" &&
                  natalLayerVisible
                }
                onChange={(selectedIds) => updateDraft((current) =>
                  activateAngularLinePoints(configuration, current, selectedIds)
                )}
              />
            </ConfigSection>

            <ConfigSection sectionId="parans" title={t("astrocart.config.parans")}>
              <ToggleRow
                checked={draft.paran.enabled}
                label={t("astrocart.config.showParans")}
                onChange={(checked) => updateDraft((current) => ({
                  ...current,
                  paran: { ...current.paran, enabled: checked },
                }), true)}
              />
              <ToggleRow
                checked={draft.paran.followLines}
                label={t("astrocart.config.followLines")}
                disabled={!draft.paran.enabled}
                onChange={(followLines) => updateDraft((current) => ({
                  ...current,
                  paran: {
                    ...current.paran,
                    followLines,
                    participantIds: followLines
                      ? supportedParanLineIds(configuration, current.staticAngleLinePointIds)
                      : current.paran.participantIds,
                  },
                }), true)}
              />
              <PointPicker
                catalog={configuration}
                role={PARAN_ROLE}
                selectedIds={draft.paran.participantIds}
                disabled={!draft.paran.enabled || draft.paran.followLines}
                onChange={(participantIds) => updateDraft((current) => ({
                  ...current,
                  paran: { ...current.paran, participantIds },
                }))}
              />
            </ConfigSection>

            <ConfigSection sectionId="aspectLines" title={t("astrocart.config.aspectLines")}>
              <AspectPicker
                available={configuration.aspects}
                selected={draft.aspects.definitions}
                onChange={(definitions) => updateDraft((current) => ({
                  ...current,
                  aspects: { ...current.aspects, definitions },
                }))}
              />
              <AnglePicker
                title={t("astrocart.config.targetAngles")}
                angles={configuration.angleKinds}
                selected={draft.aspects.targetAngleKinds}
                onChange={(angle, checked) => updateDraft((current) => ({
                  ...current,
                  aspects: {
                    ...current.aspects,
                    targetAngleKinds: toggleAngle(
                      current.aspects.targetAngleKinds,
                      angle,
                      checked,
                      configuration.angleKinds,
                    ),
                  },
                }))}
              />
              <PointPicker
                catalog={configuration}
                role={ASPECT_ROLE}
                selectedIds={draft.aspects.actorIds}
                disabled={!draft.aspects.definitions.some((definition) => definition.enabled)}
                onChange={(actorIds) => updateDraft((current) => ({
                  ...current,
                  aspects: { ...current.aspects, actorIds },
                }))}
              />
            </ConfigSection>

            <ConfigSection sectionId="dynamicLayers" title={t("astrocart.config.dynamicLayers")}>
              <div className="grid gap-[var(--aries-pane-control-gap-y)]">
                {draft.dynamicLayers.map((layer, index) => layer.sourceDocumentId ? (
                  <div
                    key={layer.sourceDocumentId}
                    className={layer.sourceDocumentId === selectedLayerDocumentId
                      ? "border-l-2 border-primary pl-2" : ""}
                  >
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <ToggleRow
                          checked={!hiddenLayerIds.includes(layer.sourceDocumentId)}
                          label={`${tf(layer.labelKey ?? `astrocart.dynamic.${layer.technique}`, layer.technique)} · ${inputDateTimeValue(linkedCursorIsoByDocumentId[layer.sourceDocumentId] ?? layer.cursorIso)}`}
                          onChange={(visible) => onLinkedLayerVisibilityChange(layer.sourceDocumentId!, visible)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => closeLayerTab(layer.sourceDocumentId!)}
                        aria-label={t("astrocart.config.removeDynamicLayer", { number: index + 1 })}
                        title={t("astrocart.config.removeDynamicLayer", { number: index + 1 })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                    {layer.technique === "lewis_ccg" ? (
                      // A setting of this layer: indented by checkbox + gap so its
                      // checkbox sits under the layer label, not in the layer column.
                      <div className="pl-[1.375rem]">
                        <ToggleRow
                          dense
                          checked={layer.progressedAnglesRa === true}
                          label={t("astrocart.config.progressedAnglesRa")}
                          onChange={(progressedAnglesRa) => {
                            void setLayerTabProgressedAngles(
                              layer.sourceDocumentId!,
                              progressedAnglesRa,
                            );
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <DynamicLayerEditor
                    key={dynamicLayerKeys[index] ?? `${documentId}:dynamic:${index}`}
                    index={index}
                    layer={layer}
                    configuration={configuration}
                    natalPointIds={draft.staticAngleLinePointIds}
                    onChange={(next) => updateDraft((current) => ({
                      ...current,
                      dynamicLayers: current.dynamicLayers.map((candidate, candidateIndex) =>
                        candidateIndex === index ? next : candidate
                      ),
                    }))}
                    onRemove={() => {
                      setDynamicLayerKeys((current) => current.filter(
                        (_key, candidateIndex) => candidateIndex !== index,
                      ));
                      updateDraft((current) => ({
                        ...current,
                        dynamicLayers: current.dynamicLayers.filter(
                          (_candidate, candidateIndex) => candidateIndex !== index,
                        ),
                      }));
                    }}
                  />
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="justify-start text-muted-foreground"
                      />
                    }
                  >
                    <Plus aria-hidden />
                    {t("astrocart.config.addDynamicLayer")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-auto min-w-[var(--aries-menu-dropdown-min-width)]"
                  >
                    {configuration.dynamicTechniques.map((technique) => (
                      <DropdownMenuItem
                        key={technique.id}
                        onClick={() => openLayerTab(technique.id)}
                      >
                        {tf(technique.labelKey, technique.id)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </ConfigSection>

            <ConfigSection sectionId="pdfExport" title={t("astrocart.pdf.exportSelection")}>
              <PdfExportControls
                pageFormat={pdfPageFormat}
                scope={pdfScope}
                onScopeChange={setPdfScope}
                dirty={dirty || saving}
                hasModes={lineModes.length > 0 || configuration.spec.paran.enabled ||
                  configuration.spec.dynamicLayers.some((layer) => layer.enabled)}
                exporting={exportingPdf}
                failed={pdfExportFailed}
                onPageFormatChange={setPdfPageFormat}
                onExport={() => void exportPdf()}
              />
            </ConfigSection>
          </div>
        ) : (
          <div className={LIST_PANE_CLASSES.error}>
            {t("astrocart.config.loadFailed")}
          </div>
        )}
      </div>

      {failed && draft ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]">
          <p className="text-[length:var(--aries-font-size-small)] text-destructive">
            {t("astrocart.config.saveFailed")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={retrySave}
          >
            {t("astrocart.config.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Which drawer sections the user left open. Retained for the app session so
// layer loads, refetches and pane reopen never snap sections back to defaults.
const configSectionOpenState = new Map<string, boolean>();

function ConfigSection({
  sectionId,
  title,
  defaultOpen = false,
  children,
}: {
  sectionId: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(
    () => configSectionOpenState.get(sectionId) ?? defaultOpen,
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        configSectionOpenState.set(sectionId, next);
        setOpen(next);
      }}
      className="border-b border-border"
    >
      <CollapsibleTrigger
        className="flex h-[var(--aries-control-height-small)] w-full items-center justify-between gap-3 px-[var(--aries-pane-header-compact-padding-x)] text-left text-[length:var(--aries-font-size-small)] font-medium text-foreground hover:bg-[color:var(--aries-surface-subtle)]"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] pb-[var(--aries-pane-header-padding-y)]">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PdfExportControls({
  pageFormat,
  scope,
  onScopeChange,
  dirty,
  hasModes,
  exporting,
  failed,
  onPageFormatChange,
  onExport,
}: {
  pageFormat: AstrocartPdfPageFormat;
  scope: AstrocartPdfScope;
  onScopeChange: (scope: AstrocartPdfScope) => void;
  dirty: boolean;
  hasModes: boolean;
  exporting: boolean;
  failed: boolean;
  onPageFormatChange: (pageFormat: AstrocartPdfPageFormat) => void;
  onExport: () => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-3">
      <SegmentedSetting
        label={t("astrocart.pdf.scope")}
        value={scope}
        onChange={onScopeChange}
        options={[
          { value: "world", label: t("astrocart.pdf.wholeWorld") },
          { value: "current", label: t("astrocart.pdf.currentMap") },
        ]}
      />
      <fieldset className="grid gap-1.5">
        <legend className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {t("astrocart.pdf.pageFormat")}
        </legend>
        <div className={cn(LIST_PANE_CLASSES.segmented, "grid grid-cols-2")}>
          {(["A4", "A3"] as const).map((format) => (
            <label
              key={format}
              className={cn(
                LIST_PANE_CLASSES.segmentedButton,
                "flex items-center justify-center gap-1.5 text-[length:var(--aries-font-size-small)]",
                pageFormat === format
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="astrocart-pdf-page-format"
                value={format}
                checked={pageFormat === format}
                onChange={() => onPageFormatChange(format)}
                className="sr-only"
              />
              <span>{format}</span>
              <span className="text-muted-foreground">
                {t("astrocart.pdf.landscape")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {dirty ? (
        <p className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {t("astrocart.pdf.applyFirst")}
        </p>
      ) : null}
      {!hasModes ? (
        <p className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {t("astrocart.pdf.chooseMode")}
        </p>
      ) : null}
      {failed ? (
        <p className="text-[length:var(--aries-font-size-small)] text-destructive">
          {t("astrocart.pdf.exportFailed")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={dirty || !hasModes || exporting}
        onClick={onExport}
      >
        {exporting ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : (
          <FileDown aria-hidden />
        )}
        {exporting
          ? t("astrocart.pdf.exporting")
          : t("astrocart.pdf.export")}
      </Button>
    </div>
  );
}

/** One labelled choice: label left, a compact content-width segmented control right. */
function SegmentedSetting<V extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  disabled?: boolean;
  onChange: (value: V) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="min-w-0 text-[length:var(--aries-font-size-small)] text-muted-foreground">
        {label}
      </span>
      <div role="group" aria-label={label} className={cn(LIST_PANE_CLASSES.segmented, "shrink-0")}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              size="xs"
              variant={selected ? "secondary" : "ghost"}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                LIST_PANE_CLASSES.segmentedButton,
                "text-xs font-normal",
                !selected && "text-muted-foreground",
              )}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  label,
  disabled = false,
  dense = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  /** Compact rows for a multi-column toggle grid. */
  dense?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn(
      "flex items-center gap-2 px-1 text-[length:var(--aries-font-size-small)] hover:bg-[color:var(--aries-surface-subtle)]",
      dense ? "min-h-6" : "min-h-7",
      disabled && "opacity-50",
    )}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[color:var(--aries-accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function AnglePicker({
  title,
  angles,
  selected,
  onChange,
}: {
  title: string;
  angles: AstrocartAngleKind[];
  selected: AstrocartAngleKind[];
  onChange: (angle: AstrocartAngleKind, checked: boolean) => void;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
        {title}
      </legend>
      <div className={cn(LIST_PANE_CLASSES.segmented, "grid grid-cols-4")}>
        {angles.map((angle) => {
          const checked = selected.includes(angle);
          return (
            <label
              key={angle}
              className={cn(
                LIST_PANE_CLASSES.segmentedButton,
                "flex cursor-default items-center justify-center text-[length:var(--aries-font-size-small)]",
                checked
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(angle, event.target.checked)}
                className="sr-only"
              />
              {angle}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function PointPicker({
  catalog,
  role,
  allowedIds,
  selectedIds,
  disabled = false,
  onResetToStandardView,
  resetDisabled = false,
  onChange,
}: {
  catalog: AstrocartConfigurationPayload;
  role: string;
  allowedIds?: string[];
  selectedIds: string[];
  disabled?: boolean;
  onResetToStandardView?: () => void;
  resetDisabled?: boolean;
  onChange: (selectedIds: string[]) => void;
}) {
  const t = useT();
  const tf = useTFallback();
  const [query, setQuery] = React.useState("");
  const familyById = React.useMemo(
    () => new Map(catalog.catalog.families.map((family) => [family.family, family])),
    [catalog.catalog.families],
  );
  const allowed = React.useMemo(
    () => allowedIds ? new Set(allowedIds) : null,
    [allowedIds],
  );
  const supported = React.useMemo(
    () => catalog.catalog.points.filter(
      (point) => (
        point.capabilities[role]?.status === "supported" &&
        (allowed == null || allowed.has(point.semanticId))
      ),
    ),
    [allowed, catalog.catalog.points, role],
  );
  const filtered = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return supported;
    return supported.filter((point) => {
      const family = familyById.get(point.family);
      const label = point.labelKey ? tf(point.labelKey, point.label) : point.label;
      const familyLabel = family ? tf(family.labelKey, family.family) : point.family;
      return `${label} ${familyLabel}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [familyById, query, supported, tf]);
  const entries = React.useMemo(() => {
    const groups = new Map<string, AstrocartPointRecord[]>();
    for (const point of filtered) {
      const items = groups.get(point.family) ?? [];
      items.push(point);
      groups.set(point.family, items);
    }
    return [...groups.entries()].flatMap(([familyId, points]) => {
      const family = familyById.get(familyId);
      return [
        {
          kind: "family" as const,
          id: familyId,
          label: family ? tf(family.labelKey, familyId) : familyId,
        },
        ...points.map((point) => ({
          kind: "point" as const,
          id: point.semanticId,
          point,
        })),
      ];
    });
  }, [familyById, filtered, tf]);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const planetIds = React.useMemo(
    () => supported
      .filter((point) => (
        point.family === "standard_body" ||
        point.family === "chiron"
      ))
      .map((point) => point.semanticId)
      .sort(),
    [supported],
  );
  const starIds = React.useMemo(
    () => supported
      .filter((point) => point.family === "fixed_star")
      .map((point) => point.semanticId)
      .sort(),
    [supported],
  );
  const planetsSelected =
    selectedIds.length === planetIds.length &&
    planetIds.every((pointId) => selected.has(pointId));
  const allStarsSelected =
    starIds.length > 0 &&
    starIds.every((pointId) => selected.has(pointId));

  return (
    <div className={cn("grid gap-1", disabled && "pointer-events-none opacity-50")}>
      <Input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("astrocart.config.searchPoints")}
        aria-label={t("astrocart.config.searchPoints")}
        className="h-[var(--aries-control-height-small)]"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button
          type="button"
          variant={planetsSelected ? "secondary" : "ghost"}
          size="xs"
          disabled={disabled || planetIds.length === 0}
          aria-pressed={planetsSelected}
          onClick={() => onChange(planetIds)}
        >
          {t("astrocart.config.planets")}
        </Button>
        {starIds.length > 0 ? (
          <Button
            type="button"
            variant={allStarsSelected ? "secondary" : "ghost"}
            size="xs"
            disabled={disabled}
            aria-pressed={allStarsSelected}
            onClick={() => {
              const next = new Set(selectedIds);
              for (const pointId of starIds) {
                if (allStarsSelected) next.delete(pointId);
                else next.add(pointId);
              }
              onChange([...next].sort());
            }}
          >
            {t("astrocart.config.allStars")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled || selectedIds.length === 0}
          onClick={() => onChange([])}
        >
          {t("astrocart.config.clearAll")}
        </Button>
        {onResetToStandardView ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled || resetDisabled}
            onClick={onResetToStandardView}
            aria-label={t("astrocart.config.resetToStandardView")}
            title={t("astrocart.config.resetToStandardView")}
            className="ml-auto text-muted-foreground"
          >
            <RotateCcw aria-hidden />
            {t("astrocart.config.standardView")}
          </Button>
        ) : null}
      </div>
      {entries.length ? (
        <VirtualPointList
          entries={entries}
          selected={selected}
          selectedIds={selectedIds}
          onChange={onChange}
          pointLabel={(point) => (
            point.labelKey ? tf(point.labelKey, point.label) : point.label
          )}
        />
      ) : (
        <div className="px-3 py-4 text-center text-muted-foreground">
          {t("astrocart.config.noMatchingPoints")}
        </div>
      )}
    </div>
  );
}

type PointPickerEntry =
  | { kind: "family"; id: string; label: string }
  | { kind: "point"; id: string; point: AstrocartPointRecord };

const POINT_PICKER_ROW_HEIGHT = 28;
const POINT_PICKER_MAX_HEIGHT = POINT_PICKER_ROW_HEIGHT * 8;
const POINT_PICKER_OVERSCAN = 5;

function VirtualPointList({
  entries,
  selected,
  selectedIds,
  onChange,
  pointLabel,
}: {
  entries: PointPickerEntry[];
  selected: Set<string>;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  pointLabel: (point: AstrocartPointRecord) => string;
}) {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const viewportHeight = Math.min(
    POINT_PICKER_MAX_HEIGHT,
    Math.max(POINT_PICKER_ROW_HEIGHT, entries.length * POINT_PICKER_ROW_HEIGHT),
  );
  const effectiveScrollTop = Math.min(
    scrollTop,
    Math.max(0, entries.length * POINT_PICKER_ROW_HEIGHT - viewportHeight),
  );
  const startIndex = Math.max(
    0,
    Math.floor(effectiveScrollTop / POINT_PICKER_ROW_HEIGHT) - POINT_PICKER_OVERSCAN,
  );
  const visibleCount =
    Math.ceil(viewportHeight / POINT_PICKER_ROW_HEIGHT) + POINT_PICKER_OVERSCAN * 2;
  const endIndex = Math.min(entries.length, startIndex + visibleCount);

  React.useEffect(() => () => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return (
    <div
      ref={scrollerRef}
      className="overflow-y-auto border border-border bg-background"
      style={{ height: viewportHeight }}
      onScroll={(event) => {
        const nextTop = event.currentTarget.scrollTop;
        if (animationFrameRef.current != null) {
          window.cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = window.requestAnimationFrame(() => {
          animationFrameRef.current = null;
          setScrollTop(nextTop);
        });
      }}
    >
      <div
        className="relative"
        style={{ height: entries.length * POINT_PICKER_ROW_HEIGHT }}
      >
        {entries.slice(startIndex, endIndex).map((entry, offset) => {
          const rowIndex = startIndex + offset;
          const rowStyle = {
            height: POINT_PICKER_ROW_HEIGHT,
            transform: `translateY(${rowIndex * POINT_PICKER_ROW_HEIGHT}px)`,
          };
          if (entry.kind === "family") {
            return (
              <div
                key={`family:${entry.id}`}
                className="absolute inset-x-0 top-0 flex items-center border-b border-border bg-[color:var(--aries-surface-subtle)] px-2 text-[length:var(--aries-font-size-micro)] text-muted-foreground"
                style={rowStyle}
              >
                {entry.label}
              </div>
            );
          }
          return (
            <label
              key={entry.id}
              className="absolute inset-x-0 top-0 flex items-center gap-2 border-b border-border/40 px-2 text-[length:var(--aries-font-size-small)] hover:bg-[color:var(--aries-surface-subtle)]"
              style={rowStyle}
            >
              <input
                type="checkbox"
                checked={selected.has(entry.point.semanticId)}
                onChange={(event) => onChange(toggleId(
                  selectedIds,
                  entry.point.semanticId,
                  event.target.checked,
                ))}
                className="size-3.5 accent-[color:var(--aries-accent)]"
              />
              <span className="min-w-0 truncate">{pointLabel(entry.point)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AspectPicker({
  available,
  selected,
  onChange,
}: {
  available: AstrocartConfigurationPayload["aspects"];
  selected: AstrocartMapSpec["aspects"]["definitions"];
  onChange: (definitions: AstrocartMapSpec["aspects"]["definitions"]) => void;
}) {
  const tf = useTFallback();
  const selectedById = React.useMemo(
    () => new Map(selected.map((definition) => [definition.id, definition])),
    [selected],
  );
  return (
    <div className="grid grid-cols-2 gap-x-2">
      {available.map((definition) => {
        const checked = selectedById.get(definition.id)?.enabled === true;
        return (
          <label
            key={definition.id}
            className="flex min-h-7 items-center gap-2 px-1 text-[length:var(--aries-font-size-small)] hover:bg-[color:var(--aries-surface-subtle)]"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                const byId = new Map(selected.map((item) => [item.id, item]));
                byId.set(definition.id, {
                  ...definition,
                  enabled: event.target.checked,
                });
                onChange(available
                  .filter((item) => byId.has(item.id))
                  .map((item) => byId.get(item.id) as typeof definition));
              }}
              className="size-3.5 accent-[color:var(--aries-accent)]"
            />
            <span className="min-w-0 flex-1 truncate">
              {tf(definition.labelKey, definition.id)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {definition.angleDeg.toFixed(
                Number.isInteger(definition.angleDeg) ? 0 : 2,
              )}°
            </span>
          </label>
        );
      })}
    </div>
  );
}

function DynamicLayerEditor({
  index,
  layer,
  configuration,
  natalPointIds,
  onChange,
  onRemove,
}: {
  index: number;
  layer: AstrocartDynamicLayer;
  configuration: AstrocartConfigurationPayload;
  natalPointIds: readonly string[];
  onChange: (layer: AstrocartDynamicLayer) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const tf = useTFallback();
  return (
    <div className="grid gap-[var(--aries-pane-control-gap-y)] border-t border-border/70 pt-[var(--aries-pane-control-gap-y)] first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[length:var(--aries-font-size-section)]">
          {t("astrocart.config.dynamicLayer", { number: index + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={t("astrocart.config.removeDynamicLayer", { number: index + 1 })}
          title={t("astrocart.config.removeDynamicLayer", { number: index + 1 })}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <ToggleRow
        checked={layer.enabled}
        label={t("astrocart.config.enableDynamicLayer")}
        onChange={(enabled) => onChange({ ...layer, enabled })}
      />
      <label className="grid gap-1">
        <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {t("astrocart.config.technique")}
        </span>
        <select
          data-aries-control-appearance="local"
          value={layer.technique}
          onChange={(event) => {
            const technique = event.target.value as AstrocartDynamicTechnique;
            // The daemon echoes progressedAnglesRa only for Lewis CCG layers.
            const { progressedAnglesRa, ...rest } = layer;
            onChange({
              ...rest,
              ...(technique === "lewis_ccg"
                ? { progressedAnglesRa: progressedAnglesRa ?? false }
                : {}),
              technique,
              labelKey: `astrocart.dynamic.${technique}`,
              movingActorIds: dynamicActorIdsForTechnique(
                configuration,
                technique,
                natalPointIds,
              ),
            });
          }}
          className="h-[var(--aries-control-height)] rounded-[var(--aries-radius-control)] border border-input bg-background px-[var(--aries-control-padding-x-compact)] outline-none focus-visible:border-ring"
        >
          {configuration.dynamicTechniques.map((technique) => (
            <option key={technique.id} value={technique.id}>
              {tf(technique.labelKey, technique.id)}
            </option>
          ))}
        </select>
      </label>
      {layer.technique === "lewis_ccg" ? (
        <ToggleRow
          checked={layer.progressedAnglesRa === true}
          label={t("astrocart.config.progressedAnglesRa")}
          onChange={(progressedAnglesRa) => onChange({ ...layer, progressedAnglesRa })}
        />
      ) : null}
      <label className="grid gap-1">
        <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">
          {t("astrocart.config.mapDateTime")}
        </span>
        <Input
          type="datetime-local"
          value={inputDateTimeValue(layer.cursorIso)}
          onChange={(event) => onChange({
            ...layer,
            cursorIso: localDateTimeInstant(event.target.value),
          })}
          className="h-8"
        />
      </label>
    </div>
  );
}
