"use client";

import { FolderOpen, GitCompare, SlidersHorizontal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChartStylePanel } from "@/components/workshell/chart-style-panel";
import { AppThemePreview } from "@/components/workshell/app-theme-preview";
import { SystemChartPicker } from "@/components/workshell/system-chart-picker";
import { ChartSurface } from "@/components/workshell/workspace-content";
import type { ChartRenderSnapshot, RenderVariant } from "@/lib/chart/types";
import type { ChartPickerRow } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import {
  fetchStyleLabPreviewManifest,
  fetchStyleLabPreviewSnapshot,
  styleLabChartSourceId,
  styleLabPreviewDefaults,
  styleLabPreviewRequestKey,
  type StyleLabPreviewField,
  type StyleLabPreviewManifest,
  type StyleLabPreviewRequest,
  type StyleLabPreviewValue,
} from "@/lib/style-lab/client";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";

import styles from "./style-lab.module.css";

type SnapshotStatus = "loading" | "ready" | "unavailable";
type PickerMode = "primary" | "comparison";

const VARIANTS: ReadonlyArray<Readonly<{
  value: RenderVariant;
  labelKey: "styleLab.variant.classic" | "styleLab.variant.compact" | "styleLab.variant.anglo";
}>> = [
  { value: "round-classic", labelKey: "styleLab.variant.classic" },
  { value: "round-compact", labelKey: "styleLab.variant.compact" },
  { value: "round-anglo", labelKey: "styleLab.variant.anglo" },
];

function fieldValue(
  field: StyleLabPreviewField,
  options: Readonly<Record<string, StyleLabPreviewValue>>,
): StyleLabPreviewValue {
  return options[field.id] ?? field.defaultValue;
}

function fieldEnabled(
  field: StyleLabPreviewField,
  options: Readonly<Record<string, StyleLabPreviewValue>>,
): boolean {
  const dependency = field.dependsOn;
  if (!dependency) return true;
  const current = options[dependency.fieldId];
  if (dependency.equals !== undefined) return current === dependency.equals;
  if (dependency.in) return dependency.in.includes(current);
  return true;
}

function serializedChoice(value: StyleLabPreviewValue): string {
  return JSON.stringify(value);
}

function StyleLabSurface() {
  const t = useT();
  const [chart, setChart] = useState<ChartRenderSnapshot | null>(null);
  const [manifest, setManifest] = useState<StyleLabPreviewManifest | null>(null);
  const [previewOptions, setPreviewOptions] = useState<Record<string, StyleLabPreviewValue>>({});
  const [primarySourceId, setPrimarySourceId] = useState<string | null>(null);
  const [comparisonSourceId, setComparisonSourceId] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>("unavailable");
  const [pickerMode, setPickerMode] = useState<PickerMode | null>("primary");
  const appliedPreviewRequestRef = useRef<string | null>(null);
  const styleGestureActive = useChartStyleEditorStore(
    (state) => state.gestureStart !== null,
  );
  const editorDomain = useChartStyleEditorStore((state) => state.editorDomain);
  const styleLabBaseTheme = useChartStyleEditorStore(
    (state) => state.styleLabBaseTheme,
  );
  const styleCssOverrides = useChartStyleEditorStore(
    (state) => state.cssOverrides,
  );
  const shellThemeStyle = useMemo(() => ({
    ...styleLabBaseTheme.appTokens,
    ...styleLabBaseTheme.chartPalette,
    ...styleCssOverrides,
    colorScheme: styleLabBaseTheme.mode,
  }) as CSSProperties, [styleCssOverrides, styleLabBaseTheme]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchStyleLabPreviewManifest(controller.signal)
      .then((nextManifest) => {
        if (controller.signal.aborted) return;
        setManifest(nextManifest);
        setPreviewOptions((current) => ({
          ...styleLabPreviewDefaults(nextManifest),
          ...current,
        }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("[style-lab-preview-schema]", error);
      });
    return () => controller.abort();
  }, []);

  const previewRequest = useMemo<StyleLabPreviewRequest | null>(() => {
    if (!primarySourceId) return null;
    return {
      chartSources: {
        primaryId: primarySourceId,
        ...(comparisonSourceId ? { comparisonId: comparisonSourceId } : {}),
      },
      previewOptions,
      fixtureState: {},
    };
  }, [comparisonSourceId, previewOptions, primarySourceId]);

  useEffect(() => {
    if (!previewRequest || styleGestureActive) return;
    const requestKey = styleLabPreviewRequestKey(previewRequest);
    if (requestKey === appliedPreviewRequestRef.current) return;
    const controller = new AbortController();
    void fetchStyleLabPreviewSnapshot(previewRequest, controller.signal)
      .then((snapshot) => {
        if (
          controller.signal.aborted ||
          useChartStyleEditorStore.getState().gestureStart !== null
        ) return;
        appliedPreviewRequestRef.current = requestKey;
        setChart(snapshot);
        setSnapshotStatus("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("[style-lab-preview]", error);
          setSnapshotStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, [previewRequest, styleGestureActive]);

  const openPickedChart = useCallback(async (row: ChartPickerRow) => {
    const sourceId = styleLabChartSourceId(row);
    appliedPreviewRequestRef.current = null;
    setSnapshotStatus("loading");
    if (pickerMode === "comparison") {
      setComparisonSourceId(sourceId);
    } else {
      setPrimarySourceId(sourceId);
      setComparisonSourceId(null);
    }
    setPickerMode(null);
  }, [pickerMode]);

  const patchPreview = useCallback((fieldId: string, value: StyleLabPreviewValue) => {
    setSnapshotStatus("loading");
    setPreviewOptions((current) => ({ ...current, [fieldId]: value }));
  }, []);

  const clearComparison = useCallback(() => {
    appliedPreviewRequestRef.current = null;
    setSnapshotStatus("loading");
    setComparisonSourceId(null);
  }, []);

  const statusLabel = snapshotStatus === "loading"
    ? t("toolbar.loadingChart")
    : t("toolbar.noChartOpen");

  const picker = pickerMode ? (
    <SystemChartPicker
      mode="open-radix"
      onPickRow={openPickedChart}
      onCancel={() => {
        if (chart) setPickerMode(null);
      }}
    />
  ) : null;

  if (picker) {
    return <main className={styles.pickerShell} style={shellThemeStyle}>{picker}</main>;
  }

  return (
    <main className={styles.labShell} style={shellThemeStyle}>
      <section
        className={styles.chartStage}
        aria-label={t(
          editorDomain === "app"
            ? "styleLab.app.preview.label"
            : "styleLab.preview.label",
        )}
        aria-busy={editorDomain === "chart" && snapshotStatus === "loading"}
      >
        {editorDomain === "app" ? (
          chart ? (
            <div className={styles.appPreviewStage}>
              <AppThemePreview chart={chart} />
            </div>
          ) : (
            <div className={styles.emptyState}>{statusLabel}</div>
          )
        ) : chart ? (
            <ChartSurface
              chart={chart}
              appControlsEnabled={false}
              inheritAppTheme={false}
            />
          ) : (
            <div className={styles.emptyState}>{statusLabel}</div>
          )}
        {editorDomain === "chart" ? <div className={styles.chartActions}>
          <div className={styles.variantSwitcher} role="group" aria-label={t("styleLab.variant.label")}>
            {VARIANTS.map((variant) => (
              <button
                key={variant.value}
                type="button"
                className={styles.variantButton}
                aria-pressed={previewOptions.variant === variant.value}
                onClick={() => patchPreview("variant", variant.value)}
              >
                {t(variant.labelKey)}
              </button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={styles.openChartButton}
              title={t("quickopt.options")}
              aria-label={t("quickopt.options")}
            >
              <SlidersHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {manifest?.groups.map((group) => {
                const fields = manifest.fields.filter((field) => (
                  field.group === group.id &&
                  field.id !== "variant" &&
                  field.applicability.includes(comparisonSourceId ? "comparison" : "single")
                ));
                if (!fields.length) return null;
                return (
                  <DropdownMenuSub key={group.id}>
                    <DropdownMenuSubTrigger>
                      {group.labelKey ? t(group.labelKey) : group.label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[70vh] min-w-72 overflow-y-auto">
                      {fields.map((field) => {
                        const value = fieldValue(field, previewOptions);
                        const enabled = fieldEnabled(field, previewOptions);
                        const label = field.labelKey ? t(field.labelKey) : field.label;
                        if (field.type === "boolean") {
                          return (
                            <DropdownMenuCheckboxItem
                              key={field.id}
                              checked={value === true}
                              disabled={!enabled}
                              onCheckedChange={(checked) => patchPreview(field.id, checked === true)}
                            >
                              {label}
                            </DropdownMenuCheckboxItem>
                          );
                        }
                        const choices = field.choices ?? [];
                        const selected = choices.find((choice) => choice.value === value);
                        return (
                          <DropdownMenuSub key={field.id}>
                            <DropdownMenuSubTrigger disabled={!enabled}>
                              <span className="min-w-0 flex-1 truncate">{label}</span>
                              <span className="max-w-24 truncate text-muted-foreground">
                                {selected
                                  ? (selected.labelKey ? t(selected.labelKey) : selected.label)
                                  : String(value)}
                              </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-52">
                              <DropdownMenuRadioGroup
                                value={serializedChoice(value)}
                                onValueChange={(serialized) => {
                                  const choice = choices.find(
                                    (candidate) => serializedChoice(candidate.value) === serialized,
                                  );
                                  if (choice) patchPreview(field.id, choice.value);
                                }}
                              >
                                {choices.map((choice) => (
                                  <DropdownMenuRadioItem
                                    key={serializedChoice(choice.value)}
                                    value={serializedChoice(choice.value)}
                                  >
                                    {choice.labelKey ? t(choice.labelKey) : choice.label}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={styles.openChartButton}
            onClick={() => setPickerMode("comparison")}
            title={t("styleLab.preview.compare")}
            aria-label={t("styleLab.preview.compare")}
          >
            <GitCompare aria-hidden="true" />
          </Button>
          {comparisonSourceId ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={styles.openChartButton}
              onClick={clearComparison}
              title={t("settings.remove")}
              aria-label={t("settings.remove")}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={styles.openChartButton}
            onClick={() => setPickerMode("primary")}
            title={t("editor.openChart")}
            aria-label={t("editor.openChart")}
          >
            <FolderOpen aria-hidden="true" />
          </Button>
        </div> : null}
      </section>

      <div className={styles.inspectorPane} aria-label={t("styleLab.inspector.label")}>
        <ChartStylePanel />
      </div>

      {picker ? (
        <div className="fixed inset-0 z-[100] bg-background">
          <div className={styles.pickerShell}>{picker}</div>
        </div>
      ) : null}
    </main>
  );
}

export function StyleLabClient() {
  return <StyleLabSurface />;
}
