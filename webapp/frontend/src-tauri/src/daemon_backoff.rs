// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Restart pacing for the daemon supervisor.
//!
//! The supervisor checks the daemon every [`SUPERVISOR_TICK`]. A daemon that
//! answered `/health` and later stops, and the first daemon that fails before
//! answering, are restarted on the next check exactly as before. Only repeated
//! failures before the daemon answers (a spawn error, or an exit before
//! `/health`) wait longer: 4, 8, 16, 32 and then at most 60 seconds, so a
//! broken install does not relaunch the engine every two seconds forever. The
//! first answer from `/health` resets the count.

use std::time::{Duration, Instant};

/// How often the supervisor looks at the daemon.
pub(crate) const SUPERVISOR_TICK: Duration = Duration::from_secs(2);
/// The longest wait between restarts after repeated start-up failures.
pub(crate) const MAX_RESTART_DELAY: Duration = Duration::from_secs(60);

/// Extra wait before the restart that follows `consecutive_failures` failures
/// before the daemon was ready. One failure restarts on the next supervisor
/// check (no extra wait); two wait 4 s, then 8, 16, 32 and 60 s at most.
pub(crate) fn restart_delay(consecutive_failures: u32) -> Duration {
    if consecutive_failures <= 1 {
        return Duration::ZERO;
    }
    let max_secs = MAX_RESTART_DELAY.as_secs();
    let secs = 1_u64
        .checked_shl(consecutive_failures)
        .filter(|secs| *secs <= max_secs)
        .unwrap_or(max_secs);
    Duration::from_secs(secs)
}

/// Start-up failures of the daemon since it last answered `/health`.
#[derive(Debug, Default)]
pub(crate) struct DaemonRestartBackoff {
    spawn_generation: u64,
    ready: bool,
    failures: u32,
    retry_at: Option<Instant>,
}

impl DaemonRestartBackoff {
    /// A daemon process was created; returns its generation for
    /// [`Self::note_ready`].
    pub(crate) fn note_spawned(&mut self) -> u64 {
        self.spawn_generation = self.spawn_generation.wrapping_add(1);
        self.ready = false;
        self.spawn_generation
    }

    /// The daemon of `generation` answered `/health`: forget past failures.
    /// An answer seen by a waiter of an older spawn does not count.
    pub(crate) fn note_ready(&mut self, generation: u64) {
        if generation != self.spawn_generation {
            return;
        }
        self.ready = true;
        self.failures = 0;
        self.retry_at = None;
    }

    /// The daemon process exited. Returns the wait before the next restart.
    pub(crate) fn note_exit(&mut self, now: Instant) -> Duration {
        if std::mem::take(&mut self.ready) {
            // A crash after a healthy start restarts right away, as before.
            return Duration::ZERO;
        }
        self.note_failure(now)
    }

    /// The daemon process could not be created. Returns the wait before the
    /// next restart.
    pub(crate) fn note_spawn_error(&mut self, now: Instant) -> Duration {
        self.ready = false;
        self.note_failure(now)
    }

    fn note_failure(&mut self, now: Instant) -> Duration {
        self.failures = self.failures.saturating_add(1);
        let delay = restart_delay(self.failures);
        self.retry_at = (!delay.is_zero()).then(|| now + delay);
        delay
    }

    /// Whether the supervisor may restart the daemon at `now`.
    pub(crate) fn may_restart(&self, now: Instant) -> bool {
        self.retry_at.map_or(true, |retry_at| now >= retry_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_delay_doubles_from_the_second_failure_and_caps_at_a_minute() {
        let secs: Vec<u64> = (0..=9).map(|n| restart_delay(n).as_secs()).collect();
        assert_eq!(secs, vec![0, 0, 4, 8, 16, 32, 60, 60, 60, 60]);
        assert_eq!(restart_delay(63), MAX_RESTART_DELAY);
        assert_eq!(restart_delay(64), MAX_RESTART_DELAY);
        assert_eq!(restart_delay(u32::MAX), MAX_RESTART_DELAY);
    }

    #[test]
    fn first_failure_and_crashes_after_a_healthy_start_restart_on_the_next_check() {
        let now = Instant::now();
        let mut backoff = DaemonRestartBackoff::default();
        let generation = backoff.note_spawned();
        assert_eq!(backoff.note_exit(now), Duration::ZERO, "first early exit");
        assert!(backoff.may_restart(now));

        let generation_2 = backoff.note_spawned();
        assert_ne!(generation, generation_2);
        backoff.note_ready(generation_2);
        for _ in 0..5 {
            assert_eq!(
                backoff.note_exit(now),
                Duration::ZERO,
                "healthy start then crash"
            );
            assert!(backoff.may_restart(now));
            let generation = backoff.note_spawned();
            backoff.note_ready(generation);
        }
    }

    #[test]
    fn repeated_failures_before_ready_back_off_and_success_resets() {
        let start = Instant::now();
        let mut backoff = DaemonRestartBackoff::default();
        backoff.note_spawned();
        assert_eq!(backoff.note_exit(start), Duration::ZERO);
        assert_eq!(backoff.note_spawn_error(start), Duration::from_secs(4));
        assert!(!backoff.may_restart(start));
        assert!(!backoff.may_restart(start + Duration::from_secs(3)));
        assert!(backoff.may_restart(start + Duration::from_secs(4)));

        backoff.note_spawned();
        assert_eq!(backoff.note_exit(start), Duration::from_secs(8));
        backoff.note_spawned();
        assert_eq!(backoff.note_exit(start), Duration::from_secs(16));
        backoff.note_spawned();
        assert_eq!(backoff.note_exit(start), Duration::from_secs(32));
        for _ in 0..4 {
            backoff.note_spawned();
            assert_eq!(backoff.note_exit(start), MAX_RESTART_DELAY);
        }
        assert!(!backoff.may_restart(start + Duration::from_secs(59)));
        assert!(backoff.may_restart(start + MAX_RESTART_DELAY));

        let generation = backoff.note_spawned();
        backoff.note_ready(generation);
        assert!(backoff.may_restart(start), "ready clears the wait");
        assert_eq!(backoff.note_exit(start), Duration::ZERO);
        backoff.note_spawned();
        assert_eq!(
            backoff.note_exit(start),
            Duration::ZERO,
            "count starts over"
        );
        backoff.note_spawned();
        assert_eq!(backoff.note_exit(start), Duration::from_secs(4));
    }

    #[test]
    fn a_stale_ready_answer_does_not_reset_the_current_spawn() {
        let now = Instant::now();
        let mut backoff = DaemonRestartBackoff::default();
        let stale = backoff.note_spawned();
        assert_eq!(backoff.note_exit(now), Duration::ZERO);
        backoff.note_spawned();
        backoff.note_ready(stale);
        assert_eq!(backoff.note_exit(now), Duration::from_secs(4));
    }
}
