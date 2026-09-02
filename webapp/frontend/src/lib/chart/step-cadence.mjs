// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const STEP_CADENCE_SCHEMA_VERSION = 2;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeGap(current, previous) {
  if (!finite(current) || !finite(previous) || current < previous) return null;
  return current - previous;
}

/**
 * Bounded, allocation-light chart-step cadence aggregation. The collector owns
 * correlation/counters only; its caller owns scheduling and summary transport.
 */
export function createStepCadenceCollector({
  maxTrackedInputs = 240,
  onSample = () => {},
} = {}) {
  let capabilities;
  let counters;
  let outcomes;
  let inputById;
  let lastInput;
  let lastCanvas;
  let lastBoundary;
  let canvasBySemanticFrame;
  let pendingSessionChangeBySemanticFrame;
  let opportunityCounts;
  let lastOpportunityTimestampByDocument;

  const reset = () => {
    capabilities = {
      nextRafCallback: typeof requestAnimationFrame === "function",
      postRenderTaskProxy: typeof requestAnimationFrame === "function",
      secondRafCallback: typeof requestAnimationFrame === "function",
      longTask: false,
    };
    counters = {
      rawInputs: 0,
      intentRecords: 0,
      appliedInputs: 0,
      stepPaints: 0,
      completedBoundaryProbes: 0,
      nextRafCallbacks: 0,
      postRenderTasks: 0,
      secondRafCallbacks: 0,
      uniqueNextRafOpportunities: 0,
      rafCollisionGroups: 0,
      rafCollisionExcess: 0,
      maxCanvasesPerNextRaf: 0,
      latePostRenderTasks: 0,
      maxAppliedInputsPerPaint: 0,
      sessionChangeTails: 0,
      sessionChangeTailsDuringBurst: 0,
      sessionChangeTailsAfterCanvas: 0,
      sessionChangeTailsBeforeCanvas: 0,
      sessionChangeTailsUnmatched: 0,
      settleStarts: 0,
      settleStartsDuringBurst: 0,
      boundaryTimeouts: 0,
      inputsWithoutBoundary: 0,
      longTasks: 0,
    };
    outcomes = {};
    inputById = new Map();
    lastInput = null;
    lastCanvas = null;
    lastBoundary = null;
    canvasBySemanticFrame = new Map();
    pendingSessionChangeBySemanticFrame = new Map();
    opportunityCounts = new Map();
    lastOpportunityTimestampByDocument = new Map();
  };

  const beginBurst = () => {
    // A speedlog window can contain several physical holds. Do not count the
    // idle pause between them as a held-key cadence gap.
    lastInput = null;
    lastCanvas = null;
    lastBoundary = null;
    lastOpportunityTimestampByDocument.clear();
  };

  const sample = (name, value, at) => {
    if (!finite(value) || value < 0) return;
    onSample(name, value, at);
  };

  const rememberInput = (input) => {
    inputById.set(input.inputId, input);
    while (inputById.size > maxTrackedInputs) {
      const firstKey = inputById.keys().next().value;
      if (firstKey === undefined) break;
      inputById.delete(firstKey);
    }
  };

  const semanticFrameKey = (docId, displayDatetime) =>
    typeof displayDatetime === "string" && displayDatetime.length > 0
      ? `${docId ?? ""}\u0000${displayDatetime}`
      : null;

  const trimMap = (map) => {
    while (map.size > maxTrackedInputs) {
      const firstKey = map.keys().next().value;
      if (firstKey === undefined) break;
      map.delete(firstKey);
    }
  };

  const firstInputAt = (inputIds, fallback) => {
    for (const inputId of inputIds) {
      const input = inputById.get(inputId);
      if (input && finite(input.at)) return input.at;
    }
    return finite(fallback) ? fallback : null;
  };

  const recordRawInput = ({ inputId, at, docId = null }) => {
    if (!Number.isInteger(inputId) || !finite(at)) return;
    counters.rawInputs += 1;
    const input = { inputId, at, docId };
    if (lastInput?.docId === docId) {
      const gap = nonNegativeGap(at, lastInput.at);
      if (gap != null) sample("time-step.input-gap", gap, at);
    }
    lastInput = input;
    rememberInput(input);
  };

  const recordIntent = ({ appliedInputs = 1 }) => {
    counters.intentRecords += 1;
    const applied = finite(appliedInputs) ? Math.max(0, appliedInputs) : 0;
    counters.appliedInputs += applied;
  };

  const recordCanvas = ({
    inputIds = [],
    appliedInputs = 1,
    intentAt = null,
    at,
    docId = null,
    displayDatetime = null,
  }) => {
    if (!finite(at)) return;
    counters.stepPaints += 1;
    const applied = finite(appliedInputs) ? Math.max(0, appliedInputs) : 0;
    counters.maxAppliedInputsPerPaint = Math.max(
      counters.maxAppliedInputsPerPaint,
      applied,
    );
    const inputAt = firstInputAt(inputIds, intentAt);
    if (lastCanvas?.docId === docId) {
      const paintGap = nonNegativeGap(at, lastCanvas.at);
      if (paintGap != null) sample("time-step.paint-gap", paintGap, at);
      if (
        paintGap != null &&
        applied === 1 &&
        lastCanvas.appliedInputs === 1 &&
        finite(inputAt) &&
        finite(lastCanvas.inputAt)
      ) {
        const inputGap = nonNegativeGap(inputAt, lastCanvas.inputAt);
        if (inputGap != null) {
          sample("time-step.paint-gap-over-input", Math.max(0, paintGap - inputGap), at);
        }
      }
    }
    lastCanvas = { at, docId, inputAt, appliedInputs: applied };
    const frameKey = semanticFrameKey(docId, displayDatetime);
    if (frameKey != null) {
      const pendingTails = pendingSessionChangeBySemanticFrame.get(frameKey);
      if (pendingTails?.length) {
        const tailAt = pendingTails.shift();
        if (pendingTails.length === 0) pendingSessionChangeBySemanticFrame.delete(frameKey);
        counters.sessionChangeTailsBeforeCanvas += 1;
        const delay = nonNegativeGap(at, tailAt);
        if (delay != null) sample("time-step.session-change-before-canvas", delay, at);
      } else {
        const canvasTimes = canvasBySemanticFrame.get(frameKey) ?? [];
        canvasTimes.push(at);
        canvasBySemanticFrame.set(frameKey, canvasTimes);
        trimMap(canvasBySemanticFrame);
      }
    }
  };

  const recordBoundary = ({
    inputIds = [],
    appliedInputs = 1,
    intentAt = null,
    canvasAt,
    nextFrameAt,
    postRenderAt,
    secondFrameAt,
    nextFrameTimestamp = null,
    secondFrameTimestamp = null,
    postRenderOrder = null,
    secondFrameOrder = null,
    docId = null,
  }) => {
    if (
      !finite(canvasAt) ||
      !finite(nextFrameAt) ||
      !finite(postRenderAt) ||
      !finite(secondFrameAt) ||
      !finite(nextFrameTimestamp) ||
      !finite(secondFrameTimestamp) ||
      !Number.isInteger(postRenderOrder) ||
      !Number.isInteger(secondFrameOrder) ||
      nextFrameAt < canvasAt ||
      postRenderAt < nextFrameAt ||
      secondFrameAt < nextFrameAt ||
      secondFrameTimestamp <= nextFrameTimestamp ||
      postRenderOrder === secondFrameOrder
    ) {
      return;
    }
    const inputAt = firstInputAt(inputIds, intentAt);
    const applied = finite(appliedInputs) ? Math.max(0, appliedInputs) : 0;
    counters.completedBoundaryProbes += 1;
    counters.nextRafCallbacks += 1;
    counters.postRenderTasks += 1;
    counters.secondRafCallbacks += 1;

    const canvasToFrame = nonNegativeGap(nextFrameAt, canvasAt);
    const inputToFrame = nonNegativeGap(nextFrameAt, inputAt);
    if (canvasToFrame != null) {
      sample("time-step.canvas-to-next-frame", canvasToFrame, nextFrameAt);
    }
    if (inputToFrame != null) {
      sample("time-step.intent-to-next-frame", inputToFrame, nextFrameAt);
    }

    const opportunityCount = (opportunityCounts.get(nextFrameTimestamp) ?? 0) + 1;
    opportunityCounts.set(nextFrameTimestamp, opportunityCount);
    if (opportunityCount === 1) {
      counters.uniqueNextRafOpportunities += 1;
    } else {
      if (opportunityCount === 2) counters.rafCollisionGroups += 1;
      counters.rafCollisionExcess += 1;
    }
    counters.maxCanvasesPerNextRaf = Math.max(
      counters.maxCanvasesPerNextRaf,
      opportunityCount,
    );
    const priorOpportunity = lastOpportunityTimestampByDocument.get(docId);
    if (finite(priorOpportunity) && nextFrameTimestamp > priorOpportunity) {
      sample(
        "time-step.next-raf-opportunity-gap",
        nextFrameTimestamp - priorOpportunity,
        nextFrameAt,
      );
    }
    if (!finite(priorOpportunity) || nextFrameTimestamp > priorOpportunity) {
      lastOpportunityTimestampByDocument.set(docId, nextFrameTimestamp);
    }

    const postRenderComparable =
      Number.isInteger(postRenderOrder) &&
      Number.isInteger(secondFrameOrder) &&
      postRenderOrder < secondFrameOrder;
    if (!postRenderComparable) {
      counters.latePostRenderTasks += 1;
    } else {
      const frameToPost = nonNegativeGap(postRenderAt, nextFrameAt);
      const canvasToPost = nonNegativeGap(postRenderAt, canvasAt);
      const inputToPost = nonNegativeGap(postRenderAt, inputAt);
      if (frameToPost != null) {
        sample("time-step.raf-to-post-render-task", frameToPost, postRenderAt);
      }
      if (canvasToPost != null) {
        sample("time-step.canvas-to-post-render-task", canvasToPost, postRenderAt);
      }
      if (inputToPost != null) {
        sample("time-step.intent-to-post-render-task", inputToPost, postRenderAt);
      }
    }

    const interval = nonNegativeGap(secondFrameTimestamp, nextFrameTimestamp);
    if (interval != null) {
      sample("time-step.next-frame-interval", interval, secondFrameAt);
    }

    if (lastBoundary?.docId === docId) {
      const postRenderGap = postRenderComparable && lastBoundary.postRenderComparable
        ? nonNegativeGap(postRenderAt, lastBoundary.postRenderAt)
        : null;
      if (postRenderGap != null && postRenderComparable) {
        sample("time-step.post-render-task-gap", postRenderGap, postRenderAt);
      }
      if (
        postRenderGap != null &&
        applied === 1 &&
        lastBoundary.appliedInputs === 1 &&
        finite(inputAt) &&
        finite(lastBoundary.inputAt)
      ) {
        const inputGap = nonNegativeGap(inputAt, lastBoundary.inputAt);
        if (inputGap != null) {
          sample(
            "time-step.post-render-gap-over-input",
            Math.max(0, postRenderGap - inputGap),
            postRenderAt,
          );
          sample(
            "time-step.post-render-gap-delta",
            Math.abs(postRenderGap - inputGap),
            postRenderAt,
          );
        }
      }
    }
    lastBoundary = {
      docId,
      inputAt,
      appliedInputs: applied,
      postRenderAt,
      postRenderComparable,
    };
    for (const inputId of inputIds) inputById.delete(inputId);
  };

  const recordSessionChange = ({
    at,
    docId = null,
    displayDatetime = null,
    duringBurst = false,
  }) => {
    counters.sessionChangeTails += 1;
    if (duringBurst) counters.sessionChangeTailsDuringBurst += 1;
    const frameKey = semanticFrameKey(docId, displayDatetime);
    if (frameKey == null) {
      counters.sessionChangeTailsUnmatched += 1;
      return;
    }
    const canvasTimes = canvasBySemanticFrame.get(frameKey);
    if (canvasTimes?.length) {
      const canvasAt = canvasTimes.shift();
      if (canvasTimes.length === 0) canvasBySemanticFrame.delete(frameKey);
      counters.sessionChangeTailsAfterCanvas += 1;
      const delay = nonNegativeGap(at, canvasAt);
      if (delay != null) sample("time-step.session-change-after-canvas", delay, at);
      return;
    }
    const pendingTails = pendingSessionChangeBySemanticFrame.get(frameKey) ?? [];
    pendingTails.push(at);
    pendingSessionChangeBySemanticFrame.set(frameKey, pendingTails);
    trimMap(pendingSessionChangeBySemanticFrame);
  };

  const recordSettleStart = ({ duringBurst = false } = {}) => {
    counters.settleStarts += 1;
    if (duringBurst) counters.settleStartsDuringBurst += 1;
  };

  const recordBoundaryTimeout = (inputIds = []) => {
    counters.boundaryTimeouts += 1;
    resolveInputsWithoutBoundary(inputIds, "boundary-timeout");
  };

  const resolveInputsWithoutBoundary = (inputIds = [], outcome = "unknown") => {
    let resolved = 0;
    for (const inputId of inputIds) {
      if (inputById.delete(inputId)) resolved += 1;
    }
    counters.inputsWithoutBoundary += resolved;
    if (resolved > 0) outcomes[outcome] = (outcomes[outcome] ?? 0) + resolved;
  };

  const recordLongTask = ({ duration, at }) => {
    if (!finite(duration) || duration < 0) return;
    counters.longTasks += 1;
    sample("browser.long-task", duration, at);
  };

  const setCapability = (name, value) => {
    if (Object.prototype.hasOwnProperty.call(capabilities, name)) {
      capabilities[name] = Boolean(value);
    }
  };

  const snapshot = () => {
    const pendingSessionTails = [...pendingSessionChangeBySemanticFrame.values()]
      .reduce((total, rows) => total + rows.length, 0);
    return {
      schemaVersion: STEP_CADENCE_SCHEMA_VERSION,
      counters: {
        ...counters,
        sessionChangeTailsUnmatched:
          counters.sessionChangeTailsUnmatched + pendingSessionTails,
        unresolvedInputs: inputById.size,
      },
      outcomes: { ...outcomes },
      capabilities: { ...capabilities },
    };
  };

  reset();
  return {
    recordRawInput,
    beginBurst,
    recordIntent,
    recordCanvas,
    recordBoundary,
    recordSessionChange,
    recordSettleStart,
    recordBoundaryTimeout,
    resolveInputsWithoutBoundary,
    recordLongTask,
    setCapability,
    snapshot,
    reset,
  };
}
