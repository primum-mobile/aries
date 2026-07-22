#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const perfDir = process.env.ARIES_PERF_OUTPUT_DIR
  ? path.resolve(process.env.ARIES_PERF_OUTPUT_DIR)
  : path.join(frontendDir, ".tmp/perf");
const runLogPath = path.join(perfDir, "chart-step-speedlog.jsonl");
const reportPath = path.join(perfDir, "render-budget-report.md");
const nativeLogPath = path.join(os.tmpdir(), "aries-speedlog.jsonl");
const budgets = JSON.parse(
  readFileSync(path.join(frontendDir, "src/lib/chart/performance-budgets.json"), "utf8"),
);

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function round(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return round((value / total) * 100, 1);
}

function changePercent(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) return null;
  return round(((current - reference) / reference) * 100, 1);
}

function budgetValue(budget) {
  return budget?.p95Ms ?? budget?.p95Value ?? null;
}

function unitFor(metricName, budget) {
  return budget?.unit ?? (metricName.endsWith("payload-bytes") ? "bytes" : "ms");
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "bytes") return `${round(value / 1024, 1)} KiB`;
  return `${round(value, 1)} ms`;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${round(value, 1)}%`;
}

function metricLabel(metricName, budget) {
  return budget?.description ?? metricName;
}

function latestNativeMetrics() {
  const latest = new Map();
  for (const row of readJsonLines(nativeLogPath)) {
    const metrics = row?.event?.detail?.metrics;
    if (!Array.isArray(metrics)) continue;
    for (const metric of metrics) latest.set(metric.name, metric);
  }
  return latest;
}

const runs = readJsonLines(runLogPath);
if (runs.length === 0) {
  throw new Error(`No chart-step runs found at ${runLogPath}. Run make perf-check first.`);
}
const run = runs.at(-1);
const measured = { ...(run.metrics ?? {}), ...(run.diagnostics ?? {}) };
const nativeMetrics = latestNativeMetrics();
const budgetRows = [];
let failedBudgets = 0;
let missingBudgets = 0;

for (const [metricName, budget] of Object.entries(budgets.metrics)) {
  const metric = measured[metricName] ?? nativeMetrics.get(metricName) ?? null;
  const unit = unitFor(metricName, budget);
  const limit = budgetValue(budget);
  const p95 = metric?.p95Ms ?? null;
  const referenceP95 = budget.reference?.p95 ?? null;
  const delta = changePercent(p95, referenceP95);
  let verdict = "No data";
  if (metric && Number.isFinite(p95)) {
    verdict = metric.samples < 10
      ? "Insufficient"
      : Number.isFinite(limit) && p95 > limit
        ? "Fail"
        : "Pass";
  }
  if (verdict === "Fail") failedBudgets += 1;
  if (verdict === "No data" || verdict === "Insufficient") missingBudgets += 1;
  budgetRows.push(
    `| ${metricLabel(metricName, budget)} | ${metric?.samples ?? 0} | ${formatValue(metric?.averageMs, unit)} | ${formatValue(metric?.p50Ms, unit)} | ${formatValue(p95, unit)} | ${formatValue(metric?.maxMs, unit)} | ${formatValue(limit, unit)} | ${formatDelta(delta)} | ${verdict} |`,
  );
}

const endToEnd = measured["time-step.first-useful-paint"];
const command = measured["time-step.command-total"];
const fetch = measured["time-step.command-fetch"];
const parse = measured["time-step.command-parse"];
const canvas = measured["chart.canvas.step_fast"];
const payload = measured["time-step.payload-bytes"];
const inputGap = measured["time-step.input-gap"];
const paintGap = measured["time-step.paint-gap"];
const paintGapOverInput = measured["time-step.paint-gap-over-input"];
const daemonTotal = measured["daemon.navigate.total"];
const daemonPreSnapshot = measured["daemon.navigate.pre-snapshot"];
const snapshotTotal = measured["daemon.snapshot.total"];
const endAverage = endToEnd?.averageMs ?? null;
const commandAverage = command?.averageMs ?? null;
const canvasAverage = canvas?.averageMs ?? null;
const residualAverage =
  Number.isFinite(endAverage) && Number.isFinite(commandAverage) && Number.isFinite(canvasAverage)
    ? Math.max(0, endAverage - commandAverage - canvasAverage)
    : null;
const transportResidualAverage =
  Number.isFinite(commandAverage) && Number.isFinite(daemonTotal?.averageMs)
    ? Math.max(0, commandAverage - daemonTotal.averageMs)
    : null;
const daemonPhaseRows = Object.entries(measured)
  .filter(([name]) => name.startsWith("daemon.snapshot.phase.") || name.startsWith("daemon.export.phase."))
  .sort((left, right) => (right[1]?.averageMs ?? 0) - (left[1]?.averageMs ?? 0));
const largestDaemonPhase = daemonPhaseRows.at(0) ?? null;

const commandReference = budgets.metrics["time-step.command-total"]?.reference;
const canvasReference = budgets.metrics["chart.canvas.step_fast"]?.reference;
const commandAverageDelta = changePercent(commandAverage, commandReference?.average);
const commandP95Delta = changePercent(command?.p95Ms, commandReference?.p95);
const canvasAverageDelta = changePercent(canvasAverage, canvasReference?.average);
const canvasP95Delta = changePercent(canvas?.p95Ms, canvasReference?.p95);

const visualContinuity = run.visualContinuity ?? null;
const visualCadence = run.visualCadence ?? null;
const overlayContinuity = run.overlayContinuity ?? null;
const displayToggleCoherence = run.displayToggleCoherence ?? null;
const missedStepRecovery = run.missedStepRecovery ?? null;
const unpaintedStepRecovery = run.unpaintedStepRecovery ?? null;
const coherenceFailed =
  (visualCadence != null && visualCadence.passed !== true) ||
  (overlayContinuity != null && overlayContinuity.passed !== true) ||
  (visualContinuity != null && visualContinuity.passed !== true) ||
  (displayToggleCoherence != null && displayToggleCoherence.passed !== true) ||
  (missedStepRecovery != null && missedStepRecovery.passed !== true) ||
  (unpaintedStepRecovery != null && unpaintedStepRecovery.passed !== true);
const coherenceMissing =
  visualCadence == null ||
  overlayContinuity == null ||
  visualContinuity == null ||
  displayToggleCoherence == null ||
  missedStepRecovery == null ||
  unpaintedStepRecovery == null;
const verdict = failedBudgets > 0 || coherenceFailed
  ? "FAIL"
  : missingBudgets > 0 || coherenceMissing
    ? "INCOMPLETE"
    : "PASS";
const lines = [
  "# Aries render budget regression report",
  "",
  `**Verdict: ${verdict}.** ${failedBudgets} budget failure(s); ${missingBudgets} metric(s) without current evidence; one-input-per-paint cadence ${visualCadence?.passed === true ? "passed" : visualCadence ? "failed" : "not measured"}; overlay continuity ${overlayContinuity?.passed === true ? "passed" : overlayContinuity ? "failed" : "not measured"}; settled-frame continuity ${visualContinuity?.passed === true ? "passed" : visualContinuity ? "failed" : "not measured"}; display-toggle ordering ${displayToggleCoherence?.passed === true ? "passed" : displayToggleCoherence ? "failed" : "not measured"}; missed-step recovery ${missedStepRecovery?.passed === true ? "passed" : missedStepRecovery ? "failed" : "not measured"}; unpainted-step recovery ${unpaintedStepRecovery?.passed === true ? "passed" : unpaintedStepRecovery ? "failed" : "not measured"}.`,
  "",
  "## Run identity",
  "",
  `- Recorded: ${run.recordedAt}`,
  `- Commit: \`${run.gitCommit}\`${run.gitDirty ? " (dirty worktree)" : ""}`,
  `- Platform: ${run.platform}`,
  `- Harness: ${run.harnessMode ?? "isolated daemon"}; Chromium ${run.browserVersion ?? "version not recorded"}`,
  `- Sample: ${run.warmupSteps} warmups + ${run.measuredSteps} measured ${run.key} steps`,
  `- Budget version: recorded ${run.budgetVersion}; evaluated ${budgets.version}`,
  "",
  "## Budget verdicts",
  "",
  "| Metric | Samples | Average | p50 | p95 | Max | Budget p95 | vs reference p95 | Verdict |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ...budgetRows,
  "",
  "## Visual coherence contract",
  "",
  `- Step presentation: ${visualCadence?.oneInputPerPaint === true ? "at most one semantic input per paint" : "merged/skipped input detected"}; ${visualCadence?.stepFastPaints ?? "—"} paints for ${visualCadence?.expectedInputs ?? "—"} inputs.`,
  `- Settle scheduling: ${visualCadence?.noSettleContention === true ? "no full semantic request started during the input burst" : "burst contention detected"}; post-burst settle requests ${visualCadence?.settleStartsAfterBurst ?? "—"}.`,
  `- Overlay during burst: ${overlayContinuity?.noBlankStepFrames === true && overlayContinuity?.currentCheapRowsNeverBlank === true ? "all previously populated groups and current cheap slots stayed visible" : "blank/strobe detected"}.`,
  `- Overlay settle: ${overlayContinuity?.cheapRowsMatchSettle === true ? "last step day/hour/lord-of-year matched full truth" : "cheap-row mismatch"}; deferred slots ${overlayContinuity?.deferredSlotsStayedPopulated === true ? "remained populated" : "blanked"}.`,
  `- Step-fast → settled body layout: ${visualContinuity?.sameBodyLayout === true ? "identical" : "not proven"}.`,
  `- Settled canvas invalidation: ${visualContinuity?.overlayOnly === true ? "semantic overlay only (no geometry repaint)" : "not proven"}.`,
  `- H display toggle: ${displayToggleCoherence?.toggles === 2 && displayToggleCoherence?.onePaintPerToggle === true ? "one canonical paint in each hide/show direction" : `${displayToggleCoherence?.totalPaints ?? "—"} paints across ${displayToggleCoherence?.toggles ?? "—"} toggles`}; stepped cursor ${displayToggleCoherence?.sameCursor === true && displayToggleCoherence?.sameSemanticFrame === true ? "preserved" : "changed or not proven"}; stale post-toggle settle paints ${displayToggleCoherence?.staleSettlePaints ?? "—"}.`,
  `- Missed step-frame recovery: ${missedStepRecovery?.fullRecoveryPaints === 1 && missedStepRecovery?.totalPaints === 1 && missedStepRecovery?.overlayOnlyPaints === 0 ? "one full current-frame paint" : `${missedStepRecovery?.fullRecoveryPaints ?? "—"} full paints / ${missedStepRecovery?.totalPaints ?? "—"} total`}; cursor ${missedStepRecovery?.cursorAdvanced === true ? "advanced" : "not proven"}; semantic frame ${missedStepRecovery?.semanticFrameAdvanced === true ? "advanced" : "not proven"}; recovery events ${missedStepRecovery?.recoveryEvents ?? "—"}.`,
  `- Published-but-unpainted step recovery: ${unpaintedStepRecovery?.fullRecoveryPaints === 1 && unpaintedStepRecovery?.totalPaints === 1 && unpaintedStepRecovery?.overlayOnlyPaints === 0 ? "one full current-frame paint" : `${unpaintedStepRecovery?.fullRecoveryPaints ?? "—"} full paints / ${unpaintedStepRecovery?.totalPaints ?? "—"} total`}; published ${unpaintedStepRecovery?.recoveryHadPublishedStep === true ? "yes" : "not proven"}; painted before settle ${unpaintedStepRecovery?.recoveryHadPaintedStep === false ? "no" : "yes or not proven"}; exact suppressed frame ${unpaintedStepRecovery?.recoveredSuppressedFrame === true ? "recovered" : "not proven"}.`,
  `- Contract verdict: ${visualCadence?.passed === true && overlayContinuity?.passed === true && visualContinuity?.passed === true && displayToggleCoherence?.passed === true && missedStepRecovery?.passed === true && unpaintedStepRecovery?.passed === true ? "Pass" : visualCadence || overlayContinuity || visualContinuity || displayToggleCoherence || missedStepRecovery || unpaintedStepRecovery ? "Fail" : "No data"}.`,
  "",
  "## Time-step attribution",
  "",
  "| Stage | Average | Share of key-to-paint average | p95 |",
  "|---|---:|---:|---:|",
  `| End-to-end key → coherent paint | ${formatValue(endAverage, "ms")} | 100% | ${formatValue(endToEnd?.p95Ms, "ms")} |`,
  `| Daemon command round-trip | ${formatValue(commandAverage, "ms")} | ${percent(commandAverage, endAverage) ?? "—"}% | ${formatValue(command?.p95Ms, "ms")} |`,
  `| Daemon processing (instrumented) | ${formatValue(daemonTotal?.averageMs, "ms")} | ${percent(daemonTotal?.averageMs, endAverage) ?? "—"}% | ${formatValue(daemonTotal?.p95Ms, "ms")} |`,
  `| Before snapshot export | ${formatValue(daemonPreSnapshot?.averageMs, "ms")} | ${percent(daemonPreSnapshot?.averageMs, endAverage) ?? "—"}% | ${formatValue(daemonPreSnapshot?.p95Ms, "ms")} |`,
  `| Snapshot generation | ${formatValue(snapshotTotal?.averageMs, "ms")} | ${percent(snapshotTotal?.averageMs, endAverage) ?? "—"}% | ${formatValue(snapshotTotal?.p95Ms, "ms")} |`,
  `| Response/transport residual (derived) | ${formatValue(transportResidualAverage, "ms")} | ${percent(transportResidualAverage, endAverage) ?? "—"}% | — |`,
  `| Network/fetch portion | ${formatValue(fetch?.averageMs, "ms")} | ${percent(fetch?.averageMs, endAverage) ?? "—"}% | ${formatValue(fetch?.p95Ms, "ms")} |`,
  `| Response JSON parse | ${formatValue(parse?.averageMs, "ms")} | ${percent(parse?.averageMs, endAverage) ?? "—"}% | ${formatValue(parse?.p95Ms, "ms")} |`,
  `| Canvas execution | ${formatValue(canvasAverage, "ms")} | ${percent(canvasAverage, endAverage) ?? "—"}% | ${formatValue(canvas?.p95Ms, "ms")} |`,
  `| Store/React/rAF residual (derived) | ${formatValue(residualAverage, "ms")} | ${percent(residualAverage, endAverage) ?? "—"}% | — |`,
  "",
  `Navigate response payload: average ${formatValue(payload?.averageMs, "bytes")}, p95 ${formatValue(payload?.p95Ms, "bytes")}, max ${formatValue(payload?.maxMs, "bytes")}.`,
  `Held-key cadence: input-gap p95 ${formatValue(inputGap?.p95Ms, "ms")}; paint-gap p95 ${formatValue(paintGap?.p95Ms, "ms")}; delay beyond measured input p95 ${formatValue(paintGapOverInput?.p95Ms, "ms")}.`,
  "",
  "## Regression against the June 15 mounted-Tauri reference",
  "",
  `- Command round-trip: average ${formatDelta(commandAverageDelta)}, p95 ${formatDelta(commandP95Delta)} (${formatValue(commandReference?.p95, "ms")} → ${formatValue(command?.p95Ms, "ms")}).`,
  `- Step-fast Canvas: average ${formatDelta(canvasAverageDelta)}, p95 ${formatDelta(canvasP95Delta)} (${formatValue(canvasReference?.p95, "ms")} → ${formatValue(canvas?.p95Ms, "ms")}).`,
  "- The command/fetch path is the dominant measured cost. JSON parsing is negligible; payload size and daemon snapshot generation/serialization are the first investigation targets.",
  "- Canvas is a smaller share of end-to-end latency. The current average and p95 deltas are reported above without converting a mixed-environment comparison into a regression verdict.",
  "- The June comparator was recorded in mounted Tauri, while the controlled gate uses an isolated daemon plus headless Chromium. Use the delta as a directional alarm only; establish the next accepted baseline after the native automatic log confirms the repaired path.",
  "",
  "## Canvas phase detail",
  "",
  "| Phase | Average | p95 | Max |",
  "|---|---:|---:|---:|",
  ...[
    ["Geometry", measured["chart.canvas.geometry"]],
    ["Dynamic layer", measured["chart.canvas.dynamic"]],
    ["Body collision layout", measured["chart.canvas.body-layout"]],
    ["Outer labels", measured["chart.canvas.outer-label"]],
    ["Hit regions", measured["chart.canvas.hit-regions"]],
  ].map(([label, metric]) =>
    `| ${label} | ${formatValue(metric?.averageMs, "ms")} | ${formatValue(metric?.p95Ms, "ms")} | ${formatValue(metric?.maxMs, "ms")} |`,
  ),
  "",
  "## Daemon snapshot/export phase detail",
  "",
  "| Phase | Average | p95 | Max |",
  "|---|---:|---:|---:|",
  ...(daemonPhaseRows.length > 0
    ? daemonPhaseRows.map(([name, metric]) =>
        `| ${name.replace("daemon.snapshot.phase.", "snapshot: ").replace("daemon.export.phase.", "export: ")} | ${formatValue(metric?.averageMs, "ms")} | ${formatValue(metric?.p95Ms, "ms")} | ${formatValue(metric?.maxMs, "ms")} |`,
      )
    : ["| No daemon phase data in this run | — | — | — |"]),
  "",
  ...(largestDaemonPhase
    ? [`Largest recorded daemon phase: \`${largestDaemonPhase[0]}\` at ${formatValue(largestDaemonPhase[1]?.averageMs, "ms")} average / ${formatValue(largestDaemonPhase[1]?.p95Ms, "ms")} p95.`]
    : ["Daemon phase timing was not present in this recorded run."]),
  "",
  "## Evidence gaps",
  "",
  ...(measured["list.scroll-to-frame"] || nativeMetrics.has("list.scroll-to-frame")
    ? ["- Stitched-list scrolling has current automatic runtime evidence."]
    : ["- Stitched-list scrolling has no current ≥10-sample runtime summary. This report does not claim list performance passed."]),
  ...(measured["chart.canvas.full"]
    ? ["- Full-chart paint has current controlled headless-harness evidence; fewer than 10 samples remains insufficient."]
    : nativeMetrics.has("chart.canvas.full")
      ? ["- Full-chart paint has current automatic native runtime evidence; fewer than 10 samples remains insufficient."]
      : ["- Full-chart paint has no current runtime evidence."]),
  "",
  "## Files",
  "",
  `- Controlled run log: \`${runLogPath}\``,
  `- Automatic native log: \`${nativeLogPath}\``,
  `- This report: \`${reportPath}\``,
  "",
];

mkdirSync(perfDir, { recursive: true });
const report = `${lines.join("\n")}\n`;
writeFileSync(reportPath, report);
console.log(report);
