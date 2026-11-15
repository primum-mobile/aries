// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** How often a revision held back by an in-flight rectification step is rechecked. */
const RADIX_REVISION_RECHECK_MS = 100;
/** How long a commit's echo stays owed once the window has passed. The daemon
 * publishes it after the list request that the commit itself started, so it
 * routinely lands just after a short window; it is still that commit's echo. */
const OWED_ECHO_DEADLINE_MS = 5000;

export type RadixRevisionGate = {
  /** A new durable radix revision reached the list. */
  observe: (seq: number) => void;
  /** A local rectification commit refreshed the list ahead of its daemon echo. */
  expectEcho: () => void;
  dispose: () => void;
};

/**
 * Holds back the daemon echo of a local rectification commit, whose refresh the
 * list already published under its own token, without ever losing a real edit.
 * Revisions that arrive while a step is in flight or inside the echo window are
 * counted; once the window has passed, the latest one applies unless every one
 * of them is accounted for by a local commit's echo. An echo that has not
 * arrived by then is still owed: the next revision pays it instead of applying.
 */
export function createRadixRevisionGate({
  suppressedForMs,
  apply,
}: {
  /** Milliseconds the echo window still runs; Infinity while a step is in flight. */
  suppressedForMs: () => number;
  apply: (seq: number) => void;
}): RadixRevisionGate {
  let observed = 0;
  let expected = 0;
  let latest: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let owed = 0;
  let owedUntil = 0;
  const payOwedEcho = () => {
    if (owed > 0 && Date.now() < owedUntil) {
      owed -= 1;
      return true;
    }
    owed = 0;
    return false;
  };
  const reset = () => {
    observed = expected = 0;
    latest = null;
  };
  const clear = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  const settle = () => {
    timer = null;
    const wait = suppressedForMs();
    if (wait > 0) {
      timer = setTimeout(settle, Number.isFinite(wait) ? wait : RADIX_REVISION_RECHECK_MS);
      return;
    }
    const pending = observed > expected ? latest : null;
    if (expected > observed) {
      owed += expected - observed;
      owedUntil = Date.now() + OWED_ECHO_DEADLINE_MS;
    }
    reset();
    if (pending != null) apply(pending);
  };
  const schedule = () => {
    if (timer == null) timer = setTimeout(settle, 0);
  };
  return {
    observe(seq) {
      if (payOwedEcho()) return;
      if (suppressedForMs() > 0) {
        observed += 1;
        latest = seq;
        schedule();
        return;
      }
      clear();
      reset();
      apply(seq);
    },
    expectEcho() {
      expected += 1;
      schedule();
    },
    dispose: clear,
  };
}
