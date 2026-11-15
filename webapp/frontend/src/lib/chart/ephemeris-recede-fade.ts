// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// The pinned natal line's recede fade: how far the other natal lines have
// receded (0 none, 1 down to the recede opacity) at a moment. Pure: the view
// retargets on a pin change and the plot frame samples it under
// requestAnimationFrame; no React state per frame. Hover never feeds it.

export type EphemerisRecedeFadeTiming = Readonly<{
  /** Pause before a fade from rest starts, so a quick click-and-release
   * never flickers. */
  delayMs: number;
  /** A full 0→1 (or 1→0) fade; a partial one takes its share. */
  durationMs: number;
  /** prefers-reduced-motion: jump to the target. */
  reducedMotion: boolean;
}>;

export type EphemerisRecedeFade = Readonly<{
  from: number;
  to: number;
  startMs: number;
  delayMs: number;
  durationMs: number;
  /** The line that stays forward while the others recede: the pinned one,
   * kept through the fade back up after release. */
  key: string | null;
}>;

/** What the radix painter reads: the recede amount and the line it spares. */
export type EphemerisRadixRecede = Readonly<{ amount: number; key: string | null }>;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** The recede amount at `nowMs` (eased out, clamped to the fade's ends). */
export function ephemerisRecedeAmount(fade: EphemerisRecedeFade, nowMs: number): number {
  if (!(fade.durationMs > 0)) return fade.to;
  const t = (nowMs - fade.startMs - fade.delayMs) / fade.durationMs;
  if (t <= 0) return fade.from;
  if (t >= 1) return fade.to;
  return fade.from + (fade.to - fade.from) * easeOutCubic(t);
}

/** True once the fade has reached its target (no more frames needed). */
export function ephemerisRecedeDone(fade: EphemerisRecedeFade, nowMs: number): boolean {
  return fade.from === fade.to || !(fade.durationMs > 0) || nowMs >= fade.startMs + fade.delayMs + fade.durationMs;
}

/** Retarget toward `to` (1 while `key` is pinned, 0 once released) from
 * wherever the fade stands at `nowMs`, continuously. A fade already moving
 * turns without a pause; one at rest (or still in its pause) waits the
 * delay. Releasing within the pause cancels it with nothing painted. */
export function retargetEphemerisRecede(
  fade: EphemerisRecedeFade | null,
  to: 0 | 1,
  key: string | null,
  nowMs: number,
  timing: EphemerisRecedeFadeTiming,
): EphemerisRecedeFade {
  const nextKey = to === 1 ? key : fade?.key ?? key;
  if (fade && fade.to === to && fade.key === nextKey) return fade;
  const current = fade ? ephemerisRecedeAmount(fade, nowMs) : 0;
  const settled = { from: to, to, startMs: nowMs, delayMs: 0, durationMs: 0, key: nextKey };
  if (timing.reducedMotion || !(timing.durationMs > 0) || current === to) return settled;
  const moving = fade != null && !ephemerisRecedeDone(fade, nowMs) && nowMs > fade.startMs + fade.delayMs;
  return {
    from: current,
    to,
    startMs: nowMs,
    delayMs: moving ? 0 : Math.max(0, timing.delayMs),
    durationMs: timing.durationMs * Math.abs(to - current),
    key: nextKey,
  };
}

/** Opacity factor for a receded line at `amount`: 1 at rest, the recede
 * opacity when fully receded. */
export function ephemerisRecedeFactor(amount: number, recedeOpacity: number): number {
  return 1 - amount * (1 - recedeOpacity);
}
