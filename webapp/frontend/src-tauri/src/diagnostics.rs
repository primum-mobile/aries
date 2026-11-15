// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Support diagnostics. A tester's report is the main signal from Windows. This module owns:
//!
//! - the Windows log folder (`%LOCALAPPDATA%\Aries\logs`) and the captured,
//!   size-capped and rotated daemon stdout/stderr written there as UTF-8;
//! - crash records for shell panics and early startup failures;
//! - the daemon startup watch that tells the window when the engine could not
//!   start (instead of leaving it empty);
//! - the redacted "Copy/Save diagnostics" report and "Open logs folder".
//!
//! The report never contains chart data, licence keys or tokens, and the
//! user's profile folder and user name are replaced. macOS keeps its existing
//! log files and behaviour: only the commands, which the macOS UI does not
//! offer, and the inert startup state are shared.

// The capture, crash and startup-watch halves run only on Windows.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// One captured daemon stream file grows to this size before it rotates.
pub(crate) const DAEMON_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Rotated copies kept next to the live file (`name.1.log`, `name.2.log`).
pub(crate) const DAEMON_LOG_KEPT_ROTATIONS: usize = 2;
/// The shell log (tauri-plugin-log) rotates at this size.
pub(crate) const SHELL_LOG_MAX_BYTES: u128 = 2 * 1024 * 1024;
/// Shell panics and pre-window startup failures.
pub(crate) const CRASH_LOG_NAME: &str = "aries-crash.log";
const CRASH_LOG_MAX_BYTES: u64 = 512 * 1024;
/// A daemon that has not answered `/health` by then is reported as hung.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
/// Consecutive exits before the first healthy answer that count as a failure.
const STARTUP_EXIT_LIMIT: u32 = 3;
/// Per log file and in total, the report keeps only recent tails.
const REPORT_TAIL_BYTES: u64 = 64 * 1024;
const REPORT_TOTAL_TAIL_BYTES: u64 = 256 * 1024;
/// Frontend errors forwarded to the shell log per session.
const FRONTEND_ERROR_LIMIT: u32 = 100;

pub(crate) const STARTUP_FAILED_EVENT: &str = "aries://daemon-startup-failed";
pub(crate) const STARTUP_RECOVERED_EVENT: &str = "aries://daemon-startup-recovered";

// ---------------------------------------------------------------------------
// Log folder

/// `%LOCALAPPDATA%` (non-roaming) on Windows.
#[cfg(target_os = "windows")]
fn local_app_data_dir() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .map(|profile| PathBuf::from(profile).join("AppData").join("Local"))
}

/// `%LOCALAPPDATA%\Aries\logs`, beside the daemon's own caches and logs.
#[cfg(target_os = "windows")]
pub(crate) fn windows_log_dir() -> Option<PathBuf> {
    local_app_data_dir().map(|dir| dir.join("Aries").join("logs"))
}

/// `%LOCALAPPDATA%\Aries\crashdumps`: Windows Error Reporting LocalDumps and
/// the shell's own minidumps (windows_crash_dump.rs).
#[cfg(target_os = "windows")]
fn windows_crash_dump_dir() -> Option<PathBuf> {
    local_app_data_dir().map(|dir| dir.join("Aries").join("crashdumps"))
}

/// Where this platform's Aries logs live. macOS keeps Tauri's log folder.
pub(crate) fn log_dir(handle: &AppHandle<Wry>) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let _ = handle;
        windows_log_dir()
    }
    #[cfg(not(target_os = "windows"))]
    {
        handle
            .path()
            .app_log_dir()
            .or_else(|_| handle.path().app_config_dir().map(|path| path.join("logs")))
            .ok()
    }
}

/// File stem of the shell's own log on Windows (`aries-shell.log`).
const WINDOWS_SHELL_LOG_STEM: &str = "aries-shell";

/// File stem of the shell log on either platform: macOS keeps Tauri's
/// default (the package name, `Aries.log`); Windows uses `aries-shell.log`.
fn shell_log_stem_for(windows: bool, package_name: &str) -> String {
    if windows {
        WINDOWS_SHELL_LOG_STEM.to_owned()
    } else {
        package_name.to_owned()
    }
}

/// File stem the shell log writer (tauri-plugin-log) is given on this
/// platform; the plugin appends `.log`. Read with `log_dir` for the folder.
pub(crate) fn shell_log_stem(package_name: &str) -> String {
    shell_log_stem_for(cfg!(target_os = "windows"), package_name)
}

/// File name of the live shell log in `log_dir`, as the bug report reads it.
pub(crate) fn shell_log_file_name(package_name: &str) -> String {
    format!("{}.log", shell_log_stem(package_name))
}

/// The tauri-plugin-log file target for the shell log: `log_dir` plus
/// `shell_log_stem`, the same pair the bug-report collector reads.
pub(crate) fn shell_log_target(handle: &AppHandle<Wry>) -> Option<tauri_plugin_log::Target> {
    let path = log_dir(handle)?;
    Some(tauri_plugin_log::Target::new(
        tauri_plugin_log::TargetKind::Folder {
            path,
            file_name: Some(shell_log_stem(&handle.package_info().name)),
        },
    ))
}

// ---------------------------------------------------------------------------
// Time

/// `YYYY-MM-DD HH:MM:SSZ` (UTC) without a date-time dependency.
pub(crate) fn utc_timestamp(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// Howard Hinnant's days-to-civil conversion (proleptic Gregorian).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

// ---------------------------------------------------------------------------
// Size-capped rotating log file

/// `aries-daemon.err.log` → `aries-daemon.err.1.log`.
fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = match path.extension() {
        Some(extension) => format!("{stem}.{index}.{}", extension.to_string_lossy()),
        None => format!("{stem}.{index}"),
    };
    path.with_file_name(name)
}

/// An append-only text log that rotates before it would pass `max_bytes`,
/// keeping `keep` older copies. Write failures are swallowed: a full disk or
/// a locked file must never stop the stream that feeds it.
pub(crate) struct RotatingLog {
    path: PathBuf,
    max_bytes: u64,
    keep: usize,
    file: Option<File>,
    written: u64,
}

impl RotatingLog {
    pub(crate) fn open(path: PathBuf, max_bytes: u64, keep: usize) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();
        let written = file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        Self {
            path,
            max_bytes,
            keep,
            file,
            written,
        }
    }

    pub(crate) fn write_bytes(&mut self, bytes: &[u8]) {
        if self.written > 0 && self.written.saturating_add(bytes.len() as u64) > self.max_bytes {
            self.rotate();
        }
        if let Some(file) = self.file.as_mut() {
            if file.write_all(bytes).is_ok() {
                let _ = file.flush();
                self.written = self.written.saturating_add(bytes.len() as u64);
            }
        }
    }

    fn rotate(&mut self) {
        // Windows cannot rename a file this process still holds open.
        self.file = None;
        if self.keep == 0 {
            let _ = fs::remove_file(&self.path);
        } else {
            let _ = fs::remove_file(rotated_path(&self.path, self.keep));
            for index in (1..self.keep).rev() {
                let _ = fs::rename(
                    rotated_path(&self.path, index),
                    rotated_path(&self.path, index + 1),
                );
            }
            let _ = fs::rename(&self.path, rotated_path(&self.path, 1));
        }
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
            .ok();
        self.written = 0;
    }
}

/// Copies one daemon stream into its log, one timestamped UTF-8 line at a
/// time. Keeps draining after write errors so the daemon never blocks on a
/// full pipe.
pub(crate) fn pump_stream<R: Read>(reader: R, mut log: RotatingLog) {
    use std::io::{BufRead, BufReader};
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(512);
    loop {
        line.clear();
        // Bounded so one endless line cannot grow without limit.
        match (&mut reader).take(64 * 1024).read_until(b'\n', &mut line) {
            Ok(0) => return,
            Ok(_) => {
                let text = String::from_utf8_lossy(&line);
                let text = text.trim_end_matches(['\r', '\n']);
                let record = format!("{} {text}\n", utc_timestamp(SystemTime::now()));
                log.write_bytes(record.as_bytes());
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

/// Windows: the daemon's stdout/stderr go through pipes into rotated files.
#[cfg(target_os = "windows")]
pub(crate) fn pipe_daemon_output(command: &mut std::process::Command) {
    use std::process::Stdio;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
}

/// Windows: start the threads that copy a freshly spawned daemon's output.
#[cfg(target_os = "windows")]
pub(crate) fn capture_daemon_output(child: &mut std::process::Child) {
    let Some(dir) = windows_log_dir() else {
        return;
    };
    if let Some(stdout) = child.stdout.take() {
        let log = RotatingLog::open(
            dir.join("aries-daemon.out.log"),
            DAEMON_LOG_MAX_BYTES,
            DAEMON_LOG_KEPT_ROTATIONS,
        );
        let _ = std::thread::Builder::new()
            .name("aries-daemon-stdout".into())
            .spawn(move || pump_stream(stdout, log));
    }
    if let Some(stderr) = child.stderr.take() {
        let log = RotatingLog::open(
            dir.join("aries-daemon.err.log"),
            DAEMON_LOG_MAX_BYTES,
            DAEMON_LOG_KEPT_ROTATIONS,
        );
        let _ = std::thread::Builder::new()
            .name("aries-daemon-stderr".into())
            .spawn(move || pump_stream(stderr, log));
    }
}

// ---------------------------------------------------------------------------
// Crash records

/// Appends one record to `aries-crash.log`, written directly (not through the
/// logger) so it lands even when the process aborts right after.
pub(crate) fn append_crash_record_to(dir: &Path, message: &str) {
    let path = dir.join(CRASH_LOG_NAME);
    let mut log = RotatingLog::open(path, CRASH_LOG_MAX_BYTES, 1);
    let record = format!(
        "{} {}\n",
        utc_timestamp(SystemTime::now()),
        message.trim_end()
    );
    log.write_bytes(record.as_bytes());
}

#[cfg(target_os = "windows")]
pub(crate) fn append_crash_record(message: &str) {
    if let Some(dir) = windows_log_dir() {
        append_crash_record_to(&dir, message);
    }
}

/// Windows: shell panics are recorded with their location and backtrace
/// before the release build aborts (`panic = "abort"`).
#[cfg(target_os = "windows")]
pub(crate) fn install_crash_logging() {
    // Minidumps for panics and native faults, in case Windows Error Reporting
    // ignores the installer's per-user LocalDumps settings.
    if let Some(dir) = windows_crash_dump_dir() {
        crate::windows_crash_dump::install(dir);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();
        let backtrace = std::backtrace::Backtrace::force_capture();
        let message = format!(
            "Aries {} panicked in thread '{thread}': {info}\n{backtrace}",
            env!("CARGO_PKG_VERSION")
        );
        append_crash_record(&message);
        log::error!("{message}");
        crate::windows_crash_dump::write_panic_dump();
        previous(info);
    }));
}

/// Records a frontend error in the shell log (Windows only calls it).
#[tauri::command]
pub(crate) fn record_frontend_error(message: String) {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    if COUNT.fetch_add(1, Ordering::Relaxed) >= FRONTEND_ERROR_LIMIT {
        return;
    }
    let message: String = message.chars().take(4000).collect();
    log::error!(target: "aries_lib::frontend", "{message}");
}

// ---------------------------------------------------------------------------
// Daemon startup watch

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaemonStartupFailure {
    /// `spawn` (could not be started), `exited` (stopped while starting) or
    /// `timeout` (no answer yet).
    pub reason: String,
    pub exit_code: Option<i32>,
    pub detail: Option<String>,
    /// For `spawn`: `missing` (the engine file is gone or damaged) or
    /// `blocked` (Windows, Smart App Control or security software refused
    /// it); see [`classify_spawn_error`]. `None` when the cause is unknown.
    pub cause: Option<String>,
    /// The log folder, shown to the user (their own path, not redacted).
    pub log_dir: Option<String>,
}

/// Startup health of the daemon this session. Fed only on Windows.
#[derive(Default)]
pub(crate) struct DaemonStartupWatch {
    healthy: AtomicBool,
    watching: AtomicBool,
    early_exits: AtomicU32,
    failure: Mutex<Option<DaemonStartupFailure>>,
}

impl DaemonStartupWatch {
    fn failure(&self) -> Option<DaemonStartupFailure> {
        self.failure.lock().ok().and_then(|failure| failure.clone())
    }

    /// Records a failure once; returns it when it is new.
    fn report(&self, failure: DaemonStartupFailure) -> Option<DaemonStartupFailure> {
        if self.healthy.load(Ordering::SeqCst) {
            return None;
        }
        let mut current = self.failure.lock().ok()?;
        if current.is_some() {
            return None;
        }
        *current = Some(failure.clone());
        Some(failure)
    }

    /// Marks the daemon healthy; returns true when a failure had been shown.
    fn mark_healthy(&self) -> bool {
        self.healthy.store(true, Ordering::SeqCst);
        self.early_exits.store(0, Ordering::SeqCst);
        self.failure
            .lock()
            .map(|mut failure| failure.take().is_some())
            .unwrap_or(false)
    }

    /// Counts an exit before the first healthy answer; the failure once the
    /// limit is reached.
    fn note_exit(
        &self,
        exit_code: Option<i32>,
        log_dir: Option<String>,
    ) -> Option<DaemonStartupFailure> {
        if self.healthy.load(Ordering::SeqCst) {
            return None;
        }
        let exits = self.early_exits.fetch_add(1, Ordering::SeqCst) + 1;
        if exits < STARTUP_EXIT_LIMIT {
            return None;
        }
        self.report(DaemonStartupFailure {
            reason: "exited".to_string(),
            exit_code,
            detail: None,
            cause: None,
            log_dir,
        })
    }
}

fn log_dir_display(app: &AppHandle<Wry>) -> Option<String> {
    log_dir(app).map(|dir| dir.display().to_string())
}

fn publish_failure(app: &AppHandle<Wry>, failure: Option<DaemonStartupFailure>) {
    let Some(failure) = failure else {
        return;
    };
    log::error!(
        "aries daemon could not start: {} (exit code {:?}, cause {}) {}",
        failure.reason,
        failure.exit_code,
        failure.cause.as_deref().unwrap_or("unknown"),
        failure.detail.as_deref().unwrap_or("")
    );
    let _ = app.emit(STARTUP_FAILED_EVENT, failure);
}

/// Why Windows refused to create the daemon process, from the `CreateProcess`
/// error: `missing` when the engine file is gone or damaged (not installed,
/// deleted or quarantined by antivirus), `blocked` when Windows, Smart App
/// Control, an application-control policy or security software refused to
/// run it. `None` keeps the generic message. Plain numbers so the mapping is
/// unit-tested on every host; only Windows calls it.
pub(crate) fn classify_spawn_error(
    raw_os_error: Option<i32>,
    kind: std::io::ErrorKind,
) -> Option<&'static str> {
    // winerror.h codes (checked against windows-sys).
    const ERROR_FILE_NOT_FOUND: u32 = 2;
    const ERROR_PATH_NOT_FOUND: u32 = 3;
    const ERROR_ACCESS_DENIED: u32 = 5;
    const ERROR_BAD_EXE_FORMAT: u32 = 193;
    const ERROR_VIRUS_INFECTED: u32 = 225;
    const ERROR_VIRUS_DELETED: u32 = 226;
    const ERROR_ACCESS_DISABLED_NO_SAFER_UI_BY_POLICY: u32 = 786;
    const ERROR_ACCESS_DISABLED_BY_POLICY: u32 = 1260;
    // App Control for Business and Smart App Control (0x800711C7 is 4551).
    const ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION: u32 = 4551;
    const ERROR_SYSTEM_INTEGRITY_REPUTATION_MALICIOUS: u32 = 4556;
    const ERROR_SYSTEM_INTEGRITY_REPUTATION_OFFLINE: u32 = 4559;
    const ERROR_SYSTEM_INTEGRITY_REPUTATION_UNFRIENDLY_FILE: u32 = 4580;
    const ERROR_SYSTEM_INTEGRITY_REPUTATION_EXPLICIT_DENY_FILE: u32 = 4582;

    let Some(raw) = raw_os_error else {
        return match kind {
            std::io::ErrorKind::NotFound => Some("missing"),
            std::io::ErrorKind::PermissionDenied => Some("blocked"),
            _ => None,
        };
    };
    let mut code = raw as u32;
    // HRESULT_FROM_WIN32 (0x8007xxxx), as some layers report it.
    if code & 0xFFFF_0000 == 0x8007_0000 {
        code &= 0xFFFF;
    }
    match code {
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND | ERROR_BAD_EXE_FORMAT => Some("missing"),
        ERROR_ACCESS_DENIED
        | ERROR_VIRUS_INFECTED
        | ERROR_VIRUS_DELETED
        | ERROR_ACCESS_DISABLED_NO_SAFER_UI_BY_POLICY
        | ERROR_ACCESS_DISABLED_BY_POLICY
        | ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION
        | ERROR_SYSTEM_INTEGRITY_REPUTATION_MALICIOUS..=ERROR_SYSTEM_INTEGRITY_REPUTATION_OFFLINE
        | ERROR_SYSTEM_INTEGRITY_REPUTATION_UNFRIENDLY_FILE
            ..=ERROR_SYSTEM_INTEGRITY_REPUTATION_EXPLICIT_DENY_FILE => Some("blocked"),
        _ => None,
    }
}

/// The daemon process could not be created (missing file, blocked by
/// antivirus or Smart App Control, ...). Logged every time; the window is
/// told once.
pub(crate) fn note_daemon_spawn_error(app: &AppHandle<Wry>, error: &std::io::Error) {
    let cause = classify_spawn_error(error.raw_os_error(), error.kind());
    log::error!(
        "aries daemon executable could not be launched (os error {:?}, cause {}): {error}",
        error.raw_os_error(),
        cause.unwrap_or("unknown")
    );
    let Some(watch) = app.try_state::<DaemonStartupWatch>() else {
        return;
    };
    let failure = watch.report(DaemonStartupFailure {
        reason: "spawn".to_string(),
        exit_code: error.raw_os_error(),
        detail: Some(error.to_string()),
        cause: cause.map(str::to_string),
        log_dir: log_dir_display(app),
    });
    publish_failure(app, failure);
}

/// The supervisor saw the daemon exit.
pub(crate) fn note_daemon_exit(app: &AppHandle<Wry>, status: std::process::ExitStatus) {
    let Some(watch) = app.try_state::<DaemonStartupWatch>() else {
        return;
    };
    if watch.healthy.load(Ordering::SeqCst) {
        log::error!("aries daemon stopped after a healthy start: {status}");
        return;
    }
    let failure = watch.note_exit(status.code(), log_dir_display(app));
    publish_failure(app, failure);
}

/// Polls `/health` after the first spawn: a daemon that never answers is
/// reported after [`STARTUP_TIMEOUT`], and a late answer clears any failure.
pub(crate) fn watch_daemon_startup(app: AppHandle<Wry>, daemon_base_url: String) {
    let Some(watch) = app.try_state::<DaemonStartupWatch>() else {
        return;
    };
    if watch.healthy.load(Ordering::SeqCst) || watch.watching.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("aries-daemon-startup-watch".into())
        .spawn(move || {
            let started = std::time::Instant::now();
            let health_url = format!("{daemon_base_url}/health");
            loop {
                let Some(watch) = app.try_state::<DaemonStartupWatch>() else {
                    return;
                };
                let stopping = app
                    .try_state::<crate::DaemonProcess>()
                    .map_or(true, |state| state.stopping.load(Ordering::SeqCst));
                if stopping {
                    watch.watching.store(false, Ordering::SeqCst);
                    return;
                }
                let healthy = ureq::get(&health_url)
                    .timeout(Duration::from_secs(2))
                    .call()
                    .is_ok_and(|response| (200..300).contains(&response.status()));
                if healthy {
                    if watch.mark_healthy() {
                        log::info!("aries daemon answered after a reported startup failure");
                        let _ = app.emit(STARTUP_RECOVERED_EVENT, ());
                    }
                    watch.watching.store(false, Ordering::SeqCst);
                    return;
                }
                if started.elapsed() >= STARTUP_TIMEOUT {
                    let failure = watch.report(DaemonStartupFailure {
                        reason: "timeout".to_string(),
                        exit_code: None,
                        detail: None,
                        cause: None,
                        log_dir: log_dir_display(&app),
                    });
                    publish_failure(&app, failure);
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
}

#[tauri::command]
pub(crate) fn get_daemon_startup_failure(app: AppHandle<Wry>) -> Option<DaemonStartupFailure> {
    app.try_state::<DaemonStartupWatch>()
        .and_then(|watch| watch.failure())
}

// ---------------------------------------------------------------------------
// Redaction

/// Removes what must not leave the user's machine: secrets (exact values),
/// the profile folder and user name, e-mail addresses, licence keys, long
/// tokens, request query strings and chart file names.
pub(crate) struct Redactor {
    secrets: Vec<String>,
    /// (profile folder spelling, replacement), longest first.
    homes: Vec<(String, String)>,
    users: Vec<String>,
}

const CHART_FILE_EXTENSIONS: &[&str] = &[
    "jsonl", "hor", "sfcht", "aaf", "md", "pdf", "png", "zip", "csv",
];

impl Redactor {
    pub(crate) fn new(secrets: Vec<String>, homes: Vec<PathBuf>, users: Vec<String>) -> Self {
        let mut home_spellings = Vec::new();
        for home in homes {
            let text = home.display().to_string();
            let text = text.trim_end_matches(['\\', '/']).to_string();
            if text.len() < 3 {
                continue;
            }
            let replacement = if text.contains('\\') || text.contains(':') {
                "%USERPROFILE%"
            } else {
                "~"
            };
            let mut variants = vec![
                text.clone(),
                text.replace('\\', "/"),
                text.replace('/', "\\"),
            ];
            variants.push(text.replace('\\', "\\\\"));
            for variant in variants {
                if !home_spellings.iter().any(|(known, _)| known == &variant) {
                    home_spellings.push((variant, replacement.to_string()));
                }
            }
        }
        home_spellings.sort_by_key(|(variant, _)| std::cmp::Reverse(variant.len()));
        let mut users: Vec<String> = users
            .into_iter()
            .map(|user| user.trim().to_string())
            .filter(|user| user.chars().count() >= 2)
            .collect();
        users.sort_by_key(|user| std::cmp::Reverse(user.len()));
        users.dedup();
        Self {
            secrets: secrets
                .into_iter()
                .filter(|secret| secret.len() >= 8)
                .collect(),
            homes: home_spellings,
            users,
        }
    }

    /// The current user's folders and names, plus the given secrets.
    pub(crate) fn for_current_user(secrets: Vec<String>) -> Self {
        let mut homes = Vec::new();
        let mut users = Vec::new();
        for key in ["USERPROFILE", "HOME"] {
            if let Some(value) = std::env::var_os(key).filter(|value| !value.is_empty()) {
                let path = PathBuf::from(value);
                if let Some(name) = path.file_name() {
                    users.push(name.to_string_lossy().into_owned());
                }
                #[cfg(target_os = "windows")]
                if let Some(short) = windows_short_path(&path) {
                    if let Some(name) = short.file_name() {
                        users.push(name.to_string_lossy().into_owned());
                    }
                    homes.push(short);
                }
                homes.push(path);
            }
        }
        for key in ["USERNAME", "USER", "LOGNAME"] {
            if let Ok(value) = std::env::var(key) {
                users.push(value);
            }
        }
        Self::new(secrets, homes, users)
    }

    pub(crate) fn redact(&self, text: &str) -> String {
        let mut text = text.to_string();
        for secret in &self.secrets {
            text = text.replace(secret.as_str(), "<redacted>");
        }
        for (home, replacement) in &self.homes {
            text = replace_case_insensitive(&text, home, replacement, false);
        }
        for user in &self.users {
            text = replace_case_insensitive(&text, user, "<user>", true);
        }
        let text = redact_emails(&text);
        let text = redact_license_keys(&text);
        let text = redact_long_tokens(&text);
        let text = redact_api_queries(&text);
        redact_chart_files(&text)
    }
}

fn chars_equal_ignoring_case(left: char, right: char) -> bool {
    left == right || left.to_lowercase().eq(right.to_lowercase())
}

/// Byte length of the prefix of `haystack` matching `needle` case-insensitively.
fn match_len_ignoring_case(haystack: &str, needle: &str) -> Option<usize> {
    let mut hay = haystack.char_indices();
    for wanted in needle.chars() {
        let (_, found) = hay.next()?;
        if !chars_equal_ignoring_case(found, wanted) {
            return None;
        }
    }
    Some(hay.next().map(|(index, _)| index).unwrap_or(haystack.len()))
}

fn is_word_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

fn replace_case_insensitive(
    text: &str,
    needle: &str,
    replacement: &str,
    whole_word: bool,
) -> String {
    if needle.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut previous: Option<char> = None;
    while index < text.len() {
        let rest = &text[index..];
        if let Some(length) = match_len_ignoring_case(rest, needle) {
            let next = rest[length..].chars().next();
            let bounded = !whole_word
                || (!previous.is_some_and(is_word_char) && !next.is_some_and(is_word_char));
            if bounded {
                out.push_str(replacement);
                previous = replacement.chars().last();
                index += length;
                continue;
            }
        }
        let character = rest.chars().next().unwrap_or_default();
        out.push(character);
        previous = Some(character);
        index += character.len_utf8();
    }
    out
}

fn is_email_local_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || "._%+-".contains(character)
}

fn is_domain_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '.' || character == '-'
}

fn redact_emails(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '@' {
            let mut start = out.len();
            let tail: Vec<char> = out.chars().collect();
            let mut local = 0;
            for character in tail.iter().rev() {
                if is_email_local_char(*character) {
                    local += 1;
                    start -= character.len_utf8();
                } else {
                    break;
                }
            }
            let mut end = index + 1;
            while end < chars.len() && is_domain_char(chars[end]) {
                end += 1;
            }
            let domain: String = chars[index + 1..end].iter().collect();
            let domain = domain.trim_end_matches(['.', '-']);
            if local > 0 && domain.contains('.') && !domain.starts_with('.') {
                out.truncate(start);
                out.push_str("<email>");
                index += 1 + domain.chars().count();
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

/// `ARIES-TRIAL-ABCD…` style licence keys (any case, with or without groups).
fn redact_license_keys(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(position) = find_ignoring_ascii_case(rest, "aries-") {
        let after = &rest[position + 6..];
        let key_len = after
            .char_indices()
            .find(|(_, character)| !(character.is_ascii_alphanumeric() || *character == '-'))
            .map(|(index, _)| index)
            .unwrap_or(after.len());
        let key = &after[..key_len];
        let alphanumeric = key
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .count();
        let preceded_by_word = rest[..position].chars().last().is_some_and(is_word_char);
        out.push_str(&rest[..position]);
        if !preceded_by_word && alphanumeric >= 12 && key.contains(|c: char| c.is_ascii_digit()) {
            out.push_str("<licence key>");
        } else {
            out.push_str(&rest[position..position + 6 + key_len]);
        }
        rest = &after[key_len..];
    }
    out.push_str(rest);
    out
}

fn find_ignoring_ascii_case(haystack: &str, needle: &str) -> Option<usize> {
    let lower = haystack.to_ascii_lowercase();
    lower.find(needle)
}

fn is_token_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-'
}

/// Activation tokens, leases and other long random strings. A 40-character
/// lowercase hex run (a source commit) stays.
fn redact_long_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut token = String::new();
    let flush = |token: &mut String, out: &mut String| {
        let is_commit = token.len() == 40
            && token
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
        let has_digit = token.chars().any(|c| c.is_ascii_digit());
        let has_letter = token.chars().any(|c| c.is_ascii_alphabetic());
        if token.len() >= 32 && has_digit && has_letter && !is_commit {
            out.push_str("<redacted>");
        } else {
            out.push_str(token);
        }
        token.clear();
    };
    for character in text.chars() {
        if is_token_char(character) {
            token.push(character);
        } else {
            flush(&mut token, &mut out);
            out.push(character);
        }
    }
    flush(&mut token, &mut out);
    out
}

/// `/api/...?query` → `/api/...?<redacted>`: queries can carry chart names.
fn redact_api_queries(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(position) = rest.find("/api/") {
        out.push_str(&rest[..position]);
        let after = &rest[position..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(after.len());
        let path = &after[..end];
        match path.find('?') {
            Some(query) => {
                out.push_str(&path[..query]);
                out.push_str("?<redacted>");
            }
            None => out.push_str(path),
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// File names of charts, notes and exports are personal: `…\Charts\Jane
/// Doe.jsonl` → `…\Charts\<file>.jsonl`. Anything below a `Charts` folder is
/// replaced up to the end of the quoted path or line.
fn redact_chart_files(text: &str) -> String {
    let mut lines = Vec::new();
    for line in text.split('\n') {
        lines.push(redact_chart_line(line));
    }
    lines.join("\n")
}

fn redact_chart_line(line: &str) -> String {
    let mut line = line.to_string();
    for separator in ["Charts\\", "Charts/"] {
        if let Some(position) = find_ignoring_ascii_case(&line, &separator.to_ascii_lowercase()) {
            let start = position + separator.len();
            let rest = &line[start..];
            let end = rest.find(['"', '\'']).unwrap_or(rest.len());
            if end > 0 {
                line = format!("{}<chart path>{}", &line[..start], &rest[end..]);
            }
        }
    }
    let lower = line.to_ascii_lowercase();
    let mut cuts: Vec<(usize, usize)> = Vec::new();
    for extension in CHART_FILE_EXTENSIONS {
        let needle = format!(".{extension}");
        let mut from = 0;
        while let Some(found) = lower[from..].find(&needle) {
            let dot = from + found;
            let after = dot + needle.len();
            from = after;
            if lower[after..].chars().next().is_some_and(is_word_char) {
                continue;
            }
            let start = line[..dot]
                .rfind(['\\', '/', '"', '\'', ':', '='])
                .map(|index| index + 1)
                .unwrap_or_else(|| {
                    line[..dot]
                        .rfind(char::is_whitespace)
                        .map(|i| i + 1)
                        .unwrap_or(0)
                });
            let start = start + line[start..dot].len() - line[start..dot].trim_start().len();
            if start < dot && !line[start..dot].contains('<') {
                cuts.push((start, dot));
            }
        }
    }
    cuts.sort();
    cuts.dedup();
    for (start, end) in cuts.into_iter().rev() {
        line.replace_range(start..end, "<file>");
    }
    line
}

// ---------------------------------------------------------------------------
// Report

/// Facts only the webview knows, sent with each report request.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct FrontendFacts {
    pub app_version: Option<String>,
    pub build_stamp: Option<String>,
    pub swiss_ephemeris: Option<String>,
    pub ui_language: Option<String>,
    pub navigator_languages: Vec<String>,
    pub device_pixel_ratio: Option<f64>,
    pub screen: Option<String>,
    pub daemon_connection: Option<String>,
    pub user_agent: Option<String>,
}

fn clip(value: &str) -> String {
    value.chars().take(300).collect()
}

/// Everything a report shows, gathered before formatting so the formatting
/// (and its redaction) can be tested without a running app.
#[derive(Debug, Default)]
pub(crate) struct ReportFacts {
    pub generated_at: String,
    pub shell_version: String,
    pub distribution: String,
    pub frontend: FrontendFacts,
    pub os: String,
    pub architecture: String,
    pub webview: Option<String>,
    pub locale: Option<String>,
    pub keyboard_layout: Option<String>,
    pub displays: Vec<String>,
    pub install_path: Option<String>,
    pub paths: Vec<(String, String)>,
    pub daemon: String,
    pub license: String,
    /// (file name, tail text)
    pub log_tails: Vec<(String, String)>,
}

pub(crate) fn format_report(facts: &ReportFacts, redactor: &Redactor) -> String {
    let mut out = String::new();
    let mut line = |key: &str, value: &str| {
        out.push_str(key);
        out.push_str(": ");
        out.push_str(&clip(value));
        out.push('\n');
    };
    line("Aries diagnostics", &facts.generated_at);
    line(
        "Privacy",
        "no chart data, no licence keys; user folder and name replaced",
    );
    let frontend = &facts.frontend;
    let version = frontend
        .app_version
        .as_deref()
        .unwrap_or(&facts.shell_version);
    line("Version", version);
    line("Shell version", &facts.shell_version);
    if let Some(stamp) = frontend
        .build_stamp
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        line("Build", stamp);
    }
    if let Some(swiss) = frontend
        .swiss_ephemeris
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        line("Swiss Ephemeris", swiss);
    }
    line("Distribution", &facts.distribution);
    line("Daemon", &facts.daemon);
    if let Some(connection) = frontend.daemon_connection.as_deref() {
        line("Daemon connection", connection);
    }
    line("Licence", &facts.license);
    line("OS", &facts.os);
    line("Architecture", &facts.architecture);
    if let Some(webview) = &facts.webview {
        line("WebView", webview);
    }
    if let Some(agent) = frontend.user_agent.as_deref() {
        line("User agent", agent);
    }
    if let Some(locale) = &facts.locale {
        line("System locale", locale);
    }
    if let Some(layout) = &facts.keyboard_layout {
        line("Keyboard layout", layout);
    }
    if let Some(language) = frontend.ui_language.as_deref() {
        line("Aries language", language);
    }
    if !frontend.navigator_languages.is_empty() {
        line(
            "Browser languages",
            &frontend.navigator_languages.join(", "),
        );
    }
    for display in &facts.displays {
        line("Display", display);
    }
    if let Some(ratio) = frontend.device_pixel_ratio {
        line("Window scale", &format!("{:.0}%", ratio * 100.0));
    }
    if let Some(screen) = frontend.screen.as_deref() {
        line("Screen", screen);
    }
    if let Some(install) = &facts.install_path {
        line("Install path", install);
    }
    for (name, path) in &facts.paths {
        line(name, path);
    }
    for (name, tail) in &facts.log_tails {
        out.push_str(&format!("\n===== {name} (end) =====\n"));
        out.push_str(tail);
        if !tail.ends_with('\n') {
            out.push('\n');
        }
    }
    redactor.redact(&out)
}

/// The last `max_bytes` of a file, starting at a line boundary.
pub(crate) fn read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if start == 0 {
        return Some(text);
    }
    Some(match text.find('\n') {
        Some(newline) => text[newline + 1..].to_string(),
        None => text,
    })
}

/// Tails of the `.log` files in `dir`, newest first, within the total budget.
pub(crate) fn collect_log_tails(dir: &Path) -> Vec<(String, String)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "log"))
        .filter_map(|path| {
            let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
            Some((modified, path))
        })
        .collect();
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    let mut budget = REPORT_TOTAL_TAIL_BYTES;
    let mut tails = Vec::new();
    for (_, path) in files {
        if budget == 0 {
            break;
        }
        let take = budget.min(REPORT_TAIL_BYTES);
        let Some(tail) = read_tail(&path, take) else {
            continue;
        };
        if tail.trim().is_empty() {
            continue;
        }
        budget = budget.saturating_sub(tail.len() as u64);
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        tails.push((name, tail));
    }
    tails
}

#[cfg(target_os = "windows")]
fn windows_short_path(path: &Path) -> Option<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;
    let wide = HSTRING::from(path.as_os_str());
    let mut buffer = vec![0u16; 1024];
    // SAFETY: `wide` is NUL-terminated and `buffer` is a valid output slice.
    let written = unsafe { GetShortPathNameW(&wide, Some(&mut buffer)) } as usize;
    if written == 0 || written >= buffer.len() {
        return None;
    }
    let short = PathBuf::from(String::from_utf16_lossy(&buffer[..written]));
    (short != path).then_some(short)
}

#[cfg(target_os = "windows")]
fn registry_string(subkey: &str, value: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let mut buffer = vec![0u16; 256];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: the buffer and its byte size describe the same allocation.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(subkey),
            &HSTRING::from(value),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let chars = (size as usize / 2).min(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..chars]);
    Some(text.trim_end_matches('\0').to_string())
}

#[cfg(target_os = "windows")]
fn registry_dword(subkey: &str, value: &str) -> Option<u32> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
    let mut data = 0u32;
    let mut size = 4u32;
    // SAFETY: `data` is a valid four-byte output.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            &HSTRING::from(subkey),
            &HSTRING::from(value),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut data as *mut u32).cast()),
            Some(&mut size),
        )
    };
    status.is_ok().then_some(data)
}

#[cfg(target_os = "windows")]
fn os_description() -> String {
    const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let product = registry_string(KEY, "ProductName").unwrap_or_else(|| "Windows".into());
    let build = registry_string(KEY, "CurrentBuild").unwrap_or_default();
    let ubr = registry_dword(KEY, "UBR");
    let display = registry_string(KEY, "DisplayVersion").unwrap_or_default();
    // Windows 11 still reports "Windows 10" as its product name.
    let product = match build.parse::<u32>() {
        Ok(number) if number >= 22_000 => product.replacen("Windows 10", "Windows 11", 1),
        _ => product,
    };
    let build = match ubr {
        Some(ubr) => format!("{build}.{ubr}"),
        None => build,
    };
    format!("{product} {display} (build {build})")
}

#[cfg(not(target_os = "windows"))]
fn os_description() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::FAMILY)
}

#[cfg(target_os = "windows")]
fn architecture_description() -> String {
    use windows::Win32::System::SystemInformation::{
        IMAGE_FILE_MACHINE, IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};
    let mut process = IMAGE_FILE_MACHINE::default();
    let mut native = IMAGE_FILE_MACHINE::default();
    // SAFETY: both outputs are valid; the pseudo handle needs no closing.
    let known =
        unsafe { IsWow64Process2(GetCurrentProcess(), &mut process, Some(&mut native)) }.is_ok();
    let build = std::env::consts::ARCH;
    if !known {
        return format!("{build} build");
    }
    match native {
        IMAGE_FILE_MACHINE_ARM64 if build == "x86_64" => {
            "x64 build on an Arm64 PC (emulated)".to_string()
        }
        IMAGE_FILE_MACHINE_ARM64 => format!("{build} build on an Arm64 PC"),
        IMAGE_FILE_MACHINE_AMD64 => format!("{build} build on an x64 PC"),
        other => format!("{build} build on machine type 0x{:04x}", other.0),
    }
}

#[cfg(not(target_os = "windows"))]
fn architecture_description() -> String {
    format!("{} build", std::env::consts::ARCH)
}

#[cfg(target_os = "windows")]
fn webview_version() -> Option<String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows::core::{PCWSTR, PWSTR};
    let mut version = PWSTR::null();
    // SAFETY: a null folder asks for the installed Evergreen runtime; the
    // returned string is freed by `take_pwstr`.
    unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) }.ok()?;
    if version.is_null() {
        return None;
    }
    Some(format!("WebView2 {}", webview2_com::take_pwstr(version)))
}

#[cfg(not(target_os = "windows"))]
fn webview_version() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn locale_and_keyboard() -> (Option<String>, Option<String>) {
    use windows::Win32::Globalization::GetUserDefaultLocaleName;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayoutNameW;
    let mut locale = [0u16; 85];
    // SAFETY: the slice is the documented LOCALE_NAME_MAX_LENGTH buffer.
    let written = unsafe { GetUserDefaultLocaleName(&mut locale) };
    let locale = (written > 1).then(|| String::from_utf16_lossy(&locale[..written as usize - 1]));
    let mut layout = [0u16; 9];
    // SAFETY: KL_NAMELENGTH (9) buffer.
    let layout = unsafe { GetKeyboardLayoutNameW(&mut layout) }
        .ok()
        .map(|()| {
            String::from_utf16_lossy(&layout)
                .trim_end_matches('\0')
                .to_string()
        });
    (locale, layout.map(|klid| format!("KLID {klid}")))
}

#[cfg(not(target_os = "windows"))]
fn locale_and_keyboard() -> (Option<String>, Option<String>) {
    (std::env::var("LANG").ok(), None)
}

fn display_descriptions(app: &AppHandle<Wry>) -> Vec<String> {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let size = monitor.size();
            let position = monitor.position();
            let name = monitor.name().cloned().unwrap_or_default();
            let marker = if primary.as_deref() == Some(name.as_str()) {
                " primary"
            } else {
                ""
            };
            format!(
                "{name} {}x{} at {},{} scale {:.0}%{marker}",
                size.width,
                size.height,
                position.x,
                position.y,
                monitor.scale_factor() * 100.0
            )
        })
        .collect()
}

fn daemon_description(app: &AppHandle<Wry>) -> String {
    let failure = get_daemon_startup_failure(app.clone());
    let Some(state) = app.try_state::<crate::DaemonProcess>() else {
        return "not initialised".to_string();
    };
    let running = match state.child.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => format!("running (pid {})", child.id()),
                Ok(Some(status)) => format!("exited ({status})"),
                Err(error) => format!("unknown ({error})"),
            },
            None if !state.access_allowed.load(Ordering::SeqCst) => {
                "not started (licence gate)".to_string()
            }
            None => "not running".to_string(),
        },
        Err(_) => "unknown".to_string(),
    };
    let transport = if state.native_transport.socket_path().is_some() {
        "socket"
    } else {
        "http"
    };
    match failure {
        Some(failure) => format!(
            "{running}, transport {transport}, startup failure: {} (exit code {:?}, cause {}) {}",
            failure.reason,
            failure.exit_code,
            failure.cause.as_deref().unwrap_or("unknown"),
            failure.detail.unwrap_or_default()
        ),
        None => format!("{running}, transport {transport}"),
    }
}

fn path_entries(app: &AppHandle<Wry>) -> Vec<(String, String)> {
    let mut paths = Vec::new();
    let mut push = |name: &str, path: Option<PathBuf>| {
        if let Some(path) = path {
            paths.push((name.to_string(), path.display().to_string()));
        }
    };
    #[cfg(target_os = "windows")]
    {
        let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
        push("Settings folder", roaming.map(|dir| dir.join("Aries")));
        push(
            "Cache folder",
            local_app_data_dir().map(|dir| dir.join("Aries")),
        );
    }
    push("Logs folder", log_dir(app));
    push("App data", app.path().app_data_dir().ok());
    push("App local data", app.path().app_local_data_dir().ok());
    push("Documents", app.path().document_dir().ok());
    #[cfg(target_os = "windows")]
    if let Some(dir) = windows_crash_dump_dir() {
        paths.push(("Crash dumps".to_string(), describe_crash_dumps(&dir)));
    }
    paths
}

/// `<folder> (2 dumps, newest 2026-11-04 13:00:00Z)` for the Windows Error
/// Reporting minidumps the installer asks for; the dumps themselves are not
/// read or attached.
pub(crate) fn describe_crash_dumps(dir: &Path) -> String {
    let mut newest: Option<SystemTime> = None;
    let mut count = 0usize;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dmp"))
            {
                continue;
            }
            count += 1;
            if let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) {
                newest = Some(newest.map_or(modified, |known| known.max(modified)));
            }
        }
    }
    match (count, newest) {
        (0, _) => format!("{} (none)", dir.display()),
        (count, Some(newest)) => format!(
            "{} ({count} dumps, newest {})",
            dir.display(),
            utc_timestamp(newest)
        ),
        (count, None) => format!("{} ({count} dumps)", dir.display()),
    }
}

/// Gathers the live facts. Slow parts (log tails) are bounded.
fn gather_facts(app: &AppHandle<Wry>, frontend: FrontendFacts) -> ReportFacts {
    let (locale, keyboard_layout) = locale_and_keyboard();
    ReportFacts {
        generated_at: utc_timestamp(SystemTime::now()),
        shell_version: app.package_info().version.to_string(),
        distribution: crate::distribution::current().as_str().to_string(),
        frontend,
        os: os_description(),
        architecture: architecture_description(),
        webview: webview_version(),
        locale,
        keyboard_layout,
        displays: display_descriptions(app),
        install_path: std::env::current_exe()
            .ok()
            .map(|path| path.display().to_string()),
        paths: path_entries(app),
        daemon: daemon_description(app),
        license: crate::licensing::diagnostics_summary(app),
        log_tails: log_dir(app)
            .map(|dir| collect_log_tails(&dir))
            .unwrap_or_default(),
    }
}

fn report_redactor(app: &AppHandle<Wry>) -> Redactor {
    let mut secrets = Vec::new();
    if let Some(state) = app.try_state::<crate::DaemonProcess>() {
        secrets.push(state.daemon_token.clone());
    }
    Redactor::for_current_user(secrets)
}

fn build_report(app: &AppHandle<Wry>, frontend: FrontendFacts) -> String {
    let facts = gather_facts(app, frontend);
    format_report(&facts, &report_redactor(app))
}

#[tauri::command]
pub(crate) async fn collect_diagnostics(
    app: AppHandle<Wry>,
    facts: FrontendFacts,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || build_report(&app, facts))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn copy_diagnostics(
    app: AppHandle<Wry>,
    facts: FrontendFacts,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let worker = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || build_report(&worker, facts))
        .await
        .map_err(|error| error.to_string())?;
    app.clipboard()
        .write_text(report)
        .map_err(|error| error.to_string())
}

/// `Aries-diagnostics-20261104-1530.txt`
fn diagnostics_file_name(now: SystemTime) -> String {
    let stamp = utc_timestamp(now);
    let compact: String = stamp
        .chars()
        .filter(|character| character.is_ascii_digit())
        .take(12)
        .collect();
    format!("Aries-diagnostics-{}-{}.txt", &compact[..8], &compact[8..])
}

/// Saves the report where the user chooses. Returns the saved path, or
/// `None` when the dialog was cancelled.
#[tauri::command]
pub(crate) async fn save_diagnostics(
    app: AppHandle<Wry>,
    window: tauri::WebviewWindow<Wry>,
    facts: FrontendFacts,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = worker
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(diagnostics_file_name(SystemTime::now()));
        if let Ok(documents) = worker.path().document_dir() {
            dialog = dialog.set_directory(documents);
        }
        let Some(target) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let target = target.into_path().map_err(|error| error.to_string())?;
        let report = build_report(&worker, facts);
        fs::write(&target, report.as_bytes()).map_err(|error| error.to_string())?;
        Ok(Some(target.display().to_string()))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Opens the log folder in Explorer (Finder elsewhere), selecting the newest
/// log when there is one.
#[tauri::command]
pub(crate) fn open_logs_folder(app: AppHandle<Wry>) -> Result<(), String> {
    let dir = log_dir(&app).ok_or_else(|| "the log folder is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let newest = fs::read_dir(&dir).ok().and_then(|entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .max_by(|left, right| left.0.cmp(&right.0))
            .map(|(_, path)| path)
    });
    reveal_in_file_manager(&dir, newest.as_deref())
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(dir: &Path, file: Option<&Path>) -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    // Explorer parses `/select,"C:\path"` itself; Windows paths cannot
    // contain quotes, so the native path (backslashes, spaces, non-ASCII)
    // passes through unchanged.
    let (target, parameters) = match file {
        Some(file) => (
            HSTRING::from("explorer.exe"),
            Some(HSTRING::from(format!("/select,\"{}\"", file.display()))),
        ),
        None => (HSTRING::from(dir.as_os_str()), None),
    };
    let parameters_ptr = parameters
        .as_ref()
        .map(|value| PCWSTR(value.as_ptr()))
        .unwrap_or(PCWSTR::null());
    // SAFETY: every string is NUL-terminated and outlives the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &target,
            parameters_ptr,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success with a value above 32.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "could not open {} ({})",
            dir.display(),
            result.0 as isize
        ))
    }
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(dir: &Path, file: Option<&Path>) -> Result<(), String> {
    let mut command = std::process::Command::new("open");
    match file {
        Some(file) => command.arg("-R").arg(file),
        None => command.arg(dir),
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn reveal_in_file_manager(dir: &Path, _file: Option<&Path>) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// tauri-plugin-log names its live file `dir.join(stem).with_extension("log")`.
    fn plugin_live_file_name(stem: &str) -> String {
        Path::new(stem)
            .with_extension("log")
            .to_string_lossy()
            .into_owned()
    }

    fn shipped_product_name() -> String {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        config["productName"].as_str().expect("productName").to_owned()
    }

    #[test]
    fn bug_report_reads_the_file_the_shell_log_writer_creates() {
        let name = shipped_product_name();
        assert_eq!(
            shell_log_file_name(&name),
            plugin_live_file_name(&shell_log_stem(&name))
        );
        let expected = if cfg!(target_os = "windows") {
            "aries-shell.log"
        } else {
            "Aries.log"
        };
        assert_eq!(shell_log_file_name(&name), expected);
    }

    #[test]
    fn shell_log_names_are_pinned_for_both_platforms() {
        let name = shipped_product_name();
        for (windows, expected) in [(true, "aries-shell.log"), (false, "Aries.log")] {
            let stem = shell_log_stem_for(windows, &name);
            assert_eq!(plugin_live_file_name(&stem), expected);
            assert_eq!(format!("{stem}.log"), expected);
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aries-diagnostics-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn windows_redactor() -> Redactor {
        Redactor::new(
            vec!["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into()],
            vec![
                PathBuf::from(r"C:\Users\Jürgen Müller"),
                PathBuf::from(r"C:\Users\JRGENM~1"),
            ],
            vec!["Jürgen Müller".into(), "JRGENM~1".into()],
        )
    }

    #[test]
    fn utc_timestamps_are_civil_dates() {
        assert_eq!(utc_timestamp(UNIX_EPOCH), "1970-01-01 00:00:00Z");
        let time = UNIX_EPOCH + Duration::from_secs(1_793_801_907);
        assert_eq!(utc_timestamp(time), "2026-11-04 14:18:27Z");
        assert_eq!(
            utc_timestamp(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29 00:00:00Z"
        );
        assert_eq!(
            diagnostics_file_name(time),
            "Aries-diagnostics-20261104-1418.txt"
        );
    }

    #[test]
    fn profile_paths_and_user_names_are_replaced_in_every_spelling() {
        let redactor = windows_redactor();
        let text = concat!(
            r"exe C:\Users\Jürgen Müller\AppData\Local\Aries\Aries.exe",
            "\n",
            r"lower c:\users\jürgen müller\AppData\Roaming\Aries",
            "\n",
            r"slashes C:/Users/Jürgen Müller/Documents",
            "\n",
            r"repr 'C:\\Users\\Jürgen Müller\\Documents\\Aries'",
            "\n",
            r"short C:\Users\JRGENM~1\AppData\Local\Aries\ephe",
            "\n",
            "hello Jürgen Müller, signed in",
        );
        let redacted = redactor.redact(text);
        assert!(!redacted.to_lowercase().contains("jürgen"), "{redacted}");
        assert!(!redacted.contains("JRGENM~1"), "{redacted}");
        assert!(redacted.contains(r"%USERPROFILE%\AppData\Local\Aries\Aries.exe"));
        assert!(redacted.contains(r"%USERPROFILE%\AppData\Roaming\Aries"));
        assert!(redacted.contains("%USERPROFILE%/Documents"));
        assert!(redacted.contains(r"%USERPROFILE%\\Documents\\Aries"));
        assert!(redacted.contains("hello <user>, signed in"));
    }

    #[test]
    fn user_names_are_replaced_only_as_whole_words() {
        let redactor = Redactor::new(Vec::new(), Vec::new(), vec!["max".into()]);
        assert_eq!(
            redactor.redact("max opened maximum settings as MAX"),
            "<user> opened maximum settings as <user>"
        );
    }

    #[test]
    fn secrets_keys_tokens_and_emails_are_removed() {
        let redactor = windows_redactor();
        let text = concat!(
            "token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n",
            "key ARIES-TRIAL-ABCD2EFGH3IJKL4MNOP5 and aries-lic-q7w8e9r0t1y2u3i4\n",
            "activation Zx81kq_MnV2-pp9QrS7tUv3wXyZ0aB1cD2eF\n",
            "commit 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c\n",
            "mail jane.doe+aries@example.co.uk replied\n",
            "lease typ ARIES-L1 stays\n",
        );
        let redacted = redactor.redact(text);
        assert!(redacted.contains("token <redacted>"), "{redacted}");
        assert!(
            redacted.contains("key <licence key> and <licence key>"),
            "{redacted}"
        );
        assert!(redacted.contains("activation <redacted>"), "{redacted}");
        assert!(redacted.contains("commit 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"));
        assert!(redacted.contains("mail <email> replied"), "{redacted}");
        assert!(redacted.contains("ARIES-L1 stays"));
    }

    #[test]
    fn chart_names_paths_and_queries_are_removed() {
        let redactor = windows_redactor();
        let text = concat!(
            r#"open failed: 'C:\Users\Jürgen Müller\Documents\Aries\Charts\Family\Anna Schmidt.jsonl'"#,
            "\n",
            r#"exported "D:\Exports\Anna Schmidt natal.pdf" ok"#,
            "\n",
            "\"GET /api/search?query=Anna%20Schmidt HTTP/1.1\" 200\n",
            "note saved to notes/Anna Schmidt.md\n",
            "loaded sefstars.txt and seas_18.se1\n",
        );
        let redacted = redactor.redact(text);
        assert!(!redacted.contains("Anna"), "{redacted}");
        assert!(!redacted.contains("Family"), "{redacted}");
        assert!(redacted.contains(r"%USERPROFILE%\Documents\Aries\Charts\<chart path>'"));
        assert!(
            redacted.contains(r#""D:\Exports\<file>.pdf" ok"#),
            "{redacted}"
        );
        assert!(
            redacted.contains("/api/search?<redacted> HTTP/1.1"),
            "{redacted}"
        );
        assert!(redacted.contains("notes/<file>.md"), "{redacted}");
        assert!(redacted.contains("loaded sefstars.txt and seas_18.se1"));
    }

    #[test]
    fn rotating_log_caps_size_and_keeps_two_older_files() {
        let dir = temp_dir("rotate");
        let path = dir.join("aries-daemon.err.log");
        let mut log = RotatingLog::open(path.clone(), 100, 2);
        for index in 0..20 {
            log.write_bytes(format!("line {index:02} padded to forty bytes.....\n").as_bytes());
        }
        drop(log);
        let live = fs::metadata(&path).expect("live").len();
        assert!(live <= 100, "{live}");
        assert!(dir.join("aries-daemon.err.1.log").exists());
        assert!(dir.join("aries-daemon.err.2.log").exists());
        assert!(!dir.join("aries-daemon.err.3.log").exists());
        let newest = fs::read_to_string(&path).expect("read");
        assert!(newest.contains("line 19"));
        // Reopening continues the size count of the existing file.
        let mut reopened = RotatingLog::open(path.clone(), 100, 2);
        reopened.write_bytes(&[b'x'; 90]);
        assert!(fs::metadata(&path).expect("live").len() <= 100);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pumped_daemon_output_is_timestamped_utf8() {
        let dir = temp_dir("pump");
        let path = dir.join("aries-daemon.out.log");
        let log = RotatingLog::open(path.clone(), 1 << 20, 2);
        let mut input = b"Traceback (most recent call last):\r\n  File \"x\"\n".to_vec();
        input.extend_from_slice(b"bad byte \xff here\nno newline at end");
        pump_stream(std::io::Cursor::new(input), log);
        let text = fs::read_to_string(&path).expect("utf-8 log");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 4, "{text}");
        assert!(lines[0].ends_with("Z Traceback (most recent call last):"));
        assert!(lines[2].contains("bad byte \u{fffd} here"));
        assert!(lines[3].ends_with("no newline at end"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn crash_records_append_with_timestamps() {
        let dir = temp_dir("crash");
        append_crash_record_to(&dir, "panicked at src/lib.rs:1:1: boom\n");
        append_crash_record_to(&dir, "second");
        let text = fs::read_to_string(dir.join(CRASH_LOG_NAME)).expect("crash log");
        assert_eq!(text.lines().count(), 2);
        assert!(text.contains("Z panicked at src/lib.rs:1:1: boom"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn log_tails_are_newest_first_and_bounded() {
        let dir = temp_dir("tails");
        let big: String = (0..20_000).map(|index| format!("row {index}\n")).collect();
        fs::write(dir.join("aries-daemon.err.log"), &big).expect("write");
        std::thread::sleep(Duration::from_millis(20));
        fs::write(dir.join("aries-shell.log"), "shell started\n").expect("write");
        fs::write(dir.join("notes.txt"), "not a log").expect("write");
        let tails = collect_log_tails(&dir);
        let names: Vec<&str> = tails.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["aries-shell.log", "aries-daemon.err.log"]);
        let daemon_tail = &tails[1].1;
        assert!(daemon_tail.len() as u64 <= REPORT_TAIL_BYTES);
        assert!(daemon_tail.starts_with("row "), "starts on a line boundary");
        assert!(daemon_tail.ends_with("row 19999\n"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn report_lists_the_support_facts_and_is_redacted() {
        let facts = ReportFacts {
            generated_at: "2026-11-04 13:38:27Z".into(),
            shell_version: "1.0.0-beta.3".into(),
            distribution: "direct".into(),
            frontend: FrontendFacts {
                app_version: Some("1.0.0b3".into()),
                build_stamp: Some("2026-11-04 abc1234".into()),
                ui_language: Some("de".into()),
                navigator_languages: vec!["de-DE".into(), "en-US".into()],
                device_pixel_ratio: Some(1.5),
                daemon_connection: Some("open".into()),
                ..FrontendFacts::default()
            },
            os: "Windows 11 Pro 23H2 (build 22631.4317)".into(),
            architecture: "x64 build on an Arm64 PC (emulated)".into(),
            webview: Some("WebView2 130.0.2849.56".into()),
            locale: Some("de-DE".into()),
            keyboard_layout: Some("KLID 00000407".into()),
            displays: vec![r"\\.\DISPLAY1 2560x1440 at 0,0 scale 150% primary".into()],
            install_path: Some(r"C:\Users\Jürgen Müller\AppData\Local\Aries\Aries.exe".into()),
            paths: vec![(
                "Settings folder".into(),
                r"C:\Users\Jürgen Müller\AppData\Roaming\Aries".into(),
            )],
            daemon: "running (pid 4242), transport http".into(),
            license: "state=active required=true configured=true seats=2".into(),
            log_tails: vec![(
                "aries-daemon.err.log".into(),
                "2026-11-04 13:00:00Z ARIES-TRIAL-ABCD2EFGH3IJKL4MNOP5 rejected".into(),
            )],
        };
        let report = format_report(&facts, &windows_redactor());
        for expected in [
            "Version: 1.0.0b3",
            "Shell version: 1.0.0-beta.3",
            "Build: 2026-11-04 abc1234",
            "OS: Windows 11 Pro 23H2 (build 22631.4317)",
            "Architecture: x64 build on an Arm64 PC (emulated)",
            "WebView: WebView2 130.0.2849.56",
            "System locale: de-DE",
            "Keyboard layout: KLID 00000407",
            "Aries language: de",
            "Browser languages: de-DE, en-US",
            "Display: \\\\.\\DISPLAY1 2560x1440 at 0,0 scale 150% primary",
            "Window scale: 150%",
            r"Install path: %USERPROFILE%\AppData\Local\Aries\Aries.exe",
            r"Settings folder: %USERPROFILE%\AppData\Roaming\Aries",
            "Daemon: running (pid 4242), transport http",
            "Licence: state=active required=true configured=true seats=2",
            "===== aries-daemon.err.log (end) =====",
            "<licence key> rejected",
        ] {
            assert!(
                report.contains(expected),
                "missing {expected:?} in\n{report}"
            );
        }
        assert!(!report.contains("Jürgen"));
        assert!(!report.contains("ABCD2EFGH3"));
    }

    #[test]
    fn crash_dumps_are_counted_not_read() {
        let dir = temp_dir("dumps");
        assert!(describe_crash_dumps(&dir).ends_with(" (none)"));
        fs::write(dir.join("aries-daemon.exe.4242.dmp"), b"MDMP").expect("write");
        fs::write(dir.join("Aries.exe.17.DMP"), b"MDMP").expect("write");
        fs::write(dir.join("readme.txt"), b"x").expect("write");
        let text = describe_crash_dumps(&dir);
        assert!(text.contains(" (2 dumps, newest "), "{text}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn startup_watch_reports_once_and_clears_when_healthy() {
        let watch = DaemonStartupWatch::default();
        assert_eq!(watch.note_exit(Some(1), None), None);
        assert_eq!(watch.note_exit(Some(1), None), None);
        let failure = watch
            .note_exit(Some(1), Some("logs".into()))
            .expect("third exit");
        assert_eq!(failure.reason, "exited");
        assert_eq!(failure.exit_code, Some(1));
        assert_eq!(watch.note_exit(Some(1), None), None, "reported once");
        assert_eq!(watch.failure(), Some(failure));
        assert!(watch.mark_healthy());
        assert_eq!(watch.failure(), None);
        assert_eq!(
            watch.note_exit(Some(1), None),
            None,
            "healthy daemons are not startup failures"
        );
        assert!(watch
            .report(DaemonStartupFailure {
                reason: "timeout".into(),
                exit_code: None,
                detail: None,
                cause: None,
                log_dir: None,
            })
            .is_none());
    }

    #[test]
    fn spawn_errors_are_classified_by_windows_error_code() {
        use std::io::ErrorKind;
        let other = ErrorKind::Other;
        for code in [2, 3, 193] {
            assert_eq!(
                classify_spawn_error(Some(code), other),
                Some("missing"),
                "{code}"
            );
        }
        for code in [
            5, 225, 226, 786, 1260, 4551, 4556, 4557, 4558, 4559, 4580, 4581, 4582,
        ] {
            assert_eq!(
                classify_spawn_error(Some(code), other),
                Some("blocked"),
                "{code}"
            );
        }
        // HRESULT_FROM_WIN32 forms: 0x800711C7 is Smart App Control's 4551.
        assert_eq!(
            classify_spawn_error(Some(0x8007_11C7_u32 as i32), other),
            Some("blocked")
        );
        assert_eq!(
            classify_spawn_error(Some(0x8007_0002_u32 as i32), other),
            Some("missing")
        );
        // Other codes keep the generic message, whatever the kind says.
        for code in [
            0,
            1,
            8,
            32,
            740,
            4550,
            4552,
            4553,
            4560,
            4583,
            0x8004_0002_u32 as i32,
        ] {
            assert_eq!(
                classify_spawn_error(Some(code), ErrorKind::NotFound),
                None,
                "{code}"
            );
        }
        // Without an OS code (e.g. the resource folder could not be resolved).
        assert_eq!(
            classify_spawn_error(None, ErrorKind::NotFound),
            Some("missing")
        );
        assert_eq!(
            classify_spawn_error(None, ErrorKind::PermissionDenied),
            Some("blocked")
        );
        assert_eq!(classify_spawn_error(None, other), None);
    }
}
