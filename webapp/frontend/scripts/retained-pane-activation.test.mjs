import assert from "node:assert/strict";
import test from "node:test";

import { sameRetainedPaneActivation } from "../src/lib/retained-pane-activation.mjs";

const livePolicy = (documentId, focusDatetime) => ({
  cursor: "source-live",
  viewport: "auto-focus",
  scrollbar: "hide-during-source-live",
  origin: "pane-open",
  sourceDocumentId: documentId,
  cursorDocumentId: documentId,
  focusDatetime,
});

test("repeated retained-list activation ignores remount counters", () => {
  assert.equal(
    sameRetainedPaneActivation(
      {
        documentId: "radix-1",
        sourceName: "Example radix",
        openSeq: 4,
        followPolicy: livePolicy("radix-1", "2026-07-25T12:00:00"),
      },
      {
        documentId: "radix-1",
        sourceName: "Example radix",
        openSeq: 5,
        followPolicy: livePolicy("radix-1", "2026-07-25T12:00:00"),
      },
    ),
    true,
  );
});

test("live pane activation does not remount for a newer seed datetime", () => {
  assert.equal(
    sameRetainedPaneActivation(
      {
        documentId: "radix-1",
        sourceName: "Example radix",
        focusDatetime: "2026-07-25T12:00:00",
        followPolicy: livePolicy("radix-1", "2026-07-25T12:00:00"),
      },
      {
        documentId: "radix-1",
        sourceName: "Example radix",
        focusDatetime: "2026-07-25T12:01:00",
        followPolicy: livePolicy("radix-1", "2026-07-25T12:01:00"),
      },
    ),
    true,
  );
});

test("different owner or semantic list mode remains a real activation", () => {
  const current = {
    documentId: "radix-1",
    sourceName: "Example radix",
    initialTab: "primary",
    followPolicy: livePolicy("radix-1", "2026-07-25T12:00:00"),
  };
  assert.equal(
    sameRetainedPaneActivation(current, {
      ...current,
      documentId: "radix-2",
      followPolicy: livePolicy("radix-2", "2026-07-25T12:00:00"),
    }),
    false,
  );
  assert.equal(
    sameRetainedPaneActivation(current, {
      ...current,
      initialTab: "circumambulation",
    }),
    false,
  );
});

test("frozen pane focus remains semantic", () => {
  const frozenPolicy = {
    ...livePolicy("radix-1", "2026-07-25T12:00:00"),
    cursor: "source-frozen",
    viewport: "preserve-anchor",
  };
  assert.equal(
    sameRetainedPaneActivation(
      { documentId: "radix-1", followPolicy: frozenPolicy },
      {
        documentId: "radix-1",
        followPolicy: {
          ...frozenPolicy,
          focusDatetime: "2026-07-26T12:00:00",
        },
      },
    ),
    false,
  );
});
