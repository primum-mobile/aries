// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  runChartSaveAfterLensMirror,
  runSemanticProfileSelection,
} from "../src/components/workshell/home-client";
import {
  createHoraryLensAdoptionGuard,
  createHoraryLensMirrorQueue,
  createLatestWinsWriteQueue,
  defaultReadingAlerts,
  detailAlerts,
  isDefaultReadingAlert,
} from "../src/components/workshell/inspector-panel";
import type { CorpusSemanticProfilesPayload } from "../src/lib/daemon/client";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

test("inspector cards keep readings and fail non-reading kinds closed", () => {
  expect([
    "verdict",
    "predicate_verdict",
    "moon_sign_lookup",
    "finding",
    "predicate_finding",
    "axis_assignment",
  ].every((kind) => isDefaultReadingAlert({ kind }))).toBe(true);
  expect([
    "condition",
    "predicate_condition",
    "source_note",
    "unknown_future_kind",
  ].some((kind) => isDefaultReadingAlert({ kind }))).toBe(false);
});

test("non-reading conditions cannot consume the twelve-card reading cap", () => {
  const conditions = Array.from({ length: 20 }, (_, index) => ({
    kind: "condition",
    id: `condition-${index}`,
    evidence: "",
    technicalDetails: "",
  }));
  const readings = Array.from({ length: 13 }, (_, index) => ({
    kind: index === 11 ? "finding" : index === 12 ? "axis_assignment" : "verdict",
    id: `reading-${index}`,
    evidence: "",
    technicalDetails: "",
  }));
  const alerts = [...conditions, ...readings];
  const visibleReadings = defaultReadingAlerts(alerts);

  expect(visibleReadings.map((item) => item.id))
    .toEqual(readings.slice(0, 12).map((item) => item.id));
  expect(detailAlerts(alerts, visibleReadings).map((item) => item.id))
    .toEqual([...conditions, readings[12]].map((item) => item.id));
});

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("document lens adoption is consumed without becoming an edit mirror", () => {
  const guard = createHoraryLensAdoptionGuard();
  guard.mark({
    discipline: "horary",
    theme: "Lost Object",
    context: { quesited_house: 2, querent_house: 1 },
  });

  // Object key order is presentation noise; semantic adoption still matches.
  expect(guard.consumeIfAdopted({
    discipline: "horary",
    theme: "Lost Object",
    context: { querent_house: 1, quesited_house: 2 },
  })).toBe(true);
  // Only the adoption-originated mutation is suppressed. A later user change
  // to the same value is a real mutation and therefore reaches the mirror.
  expect(guard.consumeIfAdopted({
    discipline: "horary",
    theme: "Lost Object",
    context: { querent_house: 1, quesited_house: 2 },
  })).toBe(false);
});

test("an adoption guard never suppresses a different user-selected lens", () => {
  const guard = createHoraryLensAdoptionGuard();
  guard.mark({ discipline: "horary", theme: "Theft" });

  expect(guard.consumeIfAdopted({
    discipline: "horary",
    theme: "Marriage Question",
  })).toBe(false);
  expect(guard.consumeIfAdopted({
    discipline: "horary",
    theme: "Theft",
  })).toBe(false);
});

test("horary lens writes reach one document in mutation order", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const calls: string[] = [];
  const queue = createHoraryLensMirrorQueue(async (_documentId, lens) => {
    const theme = lens?.theme ?? "clear";
    calls.push(theme);
    await (theme === "first" ? firstGate.promise : secondGate.promise);
  });

  const first = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "first",
  });
  const second = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "second",
  });

  await Promise.resolve();
  expect(calls).toEqual(["first"]);

  firstGate.resolve();
  await first;
  await Promise.resolve();
  expect(calls).toEqual(["first", "second"]);

  secondGate.resolve();
  await second;
});

test("a failed lens write does not strand the latest mutation", async () => {
  const calls: string[] = [];
  const queue = createHoraryLensMirrorQueue(async (_documentId, lens) => {
    const theme = lens?.theme ?? "clear";
    calls.push(theme);
    if (theme === "broken") throw new Error("daemon unavailable");
  });

  const broken = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "broken",
  });
  const latest = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "latest",
  });

  await expect(broken).rejects.toThrow("daemon unavailable");
  await latest;
  expect(calls).toEqual(["broken", "latest"]);
});

test("flush retries the latest failed lens before allowing Save", async () => {
  let attempts = 0;
  const queue = createHoraryLensMirrorQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary mirror failure");
  });
  const initial = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "question",
  });

  await expect(initial).rejects.toThrow("temporary mirror failure");
  await queue.flush("horary-1");
  expect(attempts).toBe(2);
});

test("flush waits for the latest queued daemon mirror", async () => {
  const gate = deferred();
  const queue = createHoraryLensMirrorQueue(async () => gate.promise);
  const write = queue.enqueue("horary-1", {
    discipline: "horary",
    theme: "question",
  });
  let flushed = false;
  const flush = queue.flush("horary-1").then(() => {
    flushed = true;
  });

  await Promise.resolve();
  expect(flushed).toBe(false);

  gate.resolve();
  await write;
  await flush;
  expect(flushed).toBe(true);
});

test("chart Save waits for canonical lens mirror and preserves its result", async () => {
  const gate = deferred();
  const calls: string[] = [];
  const result = { saved: true };
  const saving = runChartSaveAfterLensMirror(
    "horary-1",
    async () => {
      calls.push("save");
      return result;
    },
    async (documentId) => {
      calls.push(`flush:${documentId}`);
      await gate.promise;
    },
  );

  await Promise.resolve();
  expect(calls).toEqual(["flush:horary-1"]);

  gate.resolve();
  await expect(saving).resolves.toBe(result);
  expect(calls).toEqual(["flush:horary-1", "save"]);
});

test("chart Save does not write stale chart state when lens mirroring fails", async () => {
  let saveCalled = false;
  const saving = runChartSaveAfterLensMirror(
    "horary-1",
    async () => {
      saveCalled = true;
    },
    async () => {
      throw new Error("lens mirror failed");
    },
  );

  await expect(saving).rejects.toThrow("lens mirror failed");
  expect(saveCalled).toBe(false);
});

test("rapid semantic-profile choices serialize and retain only the latest write", async () => {
  const firstGate = deferred();
  const calls: string[] = [];
  const queue = createLatestWinsWriteQueue(async (profile: string) => {
    calls.push(profile);
    if (profile === "source-native") await firstGate.promise;
    return `${profile}:canonical`;
  });

  const first = queue.enqueue("source-native");
  const replaced = queue.enqueue("quadrant");
  const latest = queue.enqueue("hellenistic");

  await Promise.resolve();
  expect(calls).toEqual(["source-native"]);
  await expect(replaced).resolves.toEqual({
    committed: false,
    input: "quadrant",
    revision: 2,
  });

  firstGate.resolve();
  await expect(first).resolves.toEqual({
    committed: false,
    input: "source-native",
    revision: 1,
  });
  await expect(latest).resolves.toEqual({
    committed: true,
    input: "hellenistic",
    output: "hellenistic:canonical",
    revision: 3,
  });
  expect(calls).toEqual(["source-native", "hellenistic"]);
  expect(queue.isIdle()).toBe(true);
  expect(queue.revision()).toBe(3);
});

test("semantic-profile failure recovery continues to the latest choice", async () => {
  const firstGate = deferred();
  const calls: string[] = [];
  const queue = createLatestWinsWriteQueue(async (profile: string) => {
    calls.push(profile);
    if (profile === "source-native") {
      await firstGate.promise;
      throw new Error("obsolete failure");
    }
    if (profile === "quadrant") throw new Error("canonical failure");
    return profile;
  });

  const obsolete = queue.enqueue("source-native");
  const recovered = queue.enqueue("hellenistic");
  firstGate.resolve();

  await expect(obsolete).resolves.toEqual({
    committed: false,
    input: "source-native",
    revision: 1,
  });
  await expect(recovered).resolves.toMatchObject({ committed: true });
  await expect(queue.enqueue("quadrant")).rejects.toThrow("canonical failure");
  await expect(queue.enqueue("hellenistic")).resolves.toMatchObject({ committed: true });
  expect(calls).toEqual([
    "source-native",
    "hellenistic",
    "quadrant",
    "hellenistic",
  ]);
});

test("alerts refresh only for the final canonical semantic profile", async () => {
  const firstGate = deferred();
  const canonicalRefreshes: string[] = [];
  const queue = createLatestWinsWriteQueue<
    string,
    CorpusSemanticProfilesPayload
  >(async (profile) => {
    if (profile === "source-native") await firstGate.promise;
    return {
      active_profile_id: profile,
      profiles: [],
      doctrine: { preferences: {}, options: [] },
    };
  });

  const first = runSemanticProfileSelection(
    "source-native",
    (payload) => {
      canonicalRefreshes.push(payload.active_profile_id);
    },
    queue,
  );
  const latest = runSemanticProfileSelection(
    "hellenistic",
    (payload) => {
      canonicalRefreshes.push(payload.active_profile_id);
    },
    queue,
  );
  firstGate.resolve();

  await expect(first).resolves.toBe(false);
  await expect(latest).resolves.toBe(true);
  expect(canonicalRefreshes).toEqual(["hellenistic"]);
});

test("a newer profile click suppresses a completion awaiting publication", async () => {
  const firstGate = deferred();
  const canonicalRefreshes: string[] = [];
  const queue = createLatestWinsWriteQueue<
    string,
    CorpusSemanticProfilesPayload
  >(async (profile) => {
    if (profile === "source-native") await firstGate.promise;
    return {
      active_profile_id: profile,
      profiles: [],
      doctrine: { preferences: {}, options: [] },
    };
  });
  const publish = (payload: CorpusSemanticProfilesPayload) => {
    canonicalRefreshes.push(payload.active_profile_id);
  };
  const first = runSemanticProfileSelection(
    "source-native",
    publish,
    queue,
  );
  let latest: Promise<boolean> | null = null;

  firstGate.resolve();
  queueMicrotask(() => {
    latest = runSemanticProfileSelection("quadrant", publish, queue);
  });

  await expect(first).resolves.toBe(false);
  expect(latest).not.toBeNull();
  await expect(latest!).resolves.toBe(true);
  expect(canonicalRefreshes).toEqual(["quadrant"]);
});

test("custom semantic-profile slugs use the shared persistence path", async () => {
  const writes: string[] = [];
  const queue = createLatestWinsWriteQueue<string, CorpusSemanticProfilesPayload>(
    async (profile) => {
      writes.push(profile);
      return {
        active_profile_id: profile,
        profiles: [],
        doctrine: { preferences: {}, options: [] },
      };
    },
  );
  const canonicalRefreshes: string[] = [];

  await expect(runSemanticProfileSelection(
    "traditional-custom",
    (payload) => {
      canonicalRefreshes.push(payload.active_profile_id);
    },
    queue,
  )).resolves.toBe(true);
  expect(writes).toEqual(["traditional-custom"]);
  expect(canonicalRefreshes).toEqual(["traditional-custom"]);
});
