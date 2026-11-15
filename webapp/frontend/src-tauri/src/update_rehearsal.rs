// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Windows release rehearsal (CI only).
//!
//! Compiled in only with the `update-rehearsal` Cargo feature, which
//! `.github/workflows/windows-release-rehearsal.yml` enables for throwaway
//! `*-rehearsal.N` builds; build.rs refuses the feature for any other version,
//! and release builds never pass it. With `ARIES_UPDATE_REHEARSAL_ENDPOINT`
//! set, the app checks that endpoint (a local HTTPS server on the runner that
//! answers from the real release manifest code) without a licence, downloads
//! and verifies the update against the configured updater public key, and
//! starts the installer exactly as the licensed path does: the plugin runs
//! the NSIS installer in passive mode with `/UPDATE` and exits the process.
//!
//! `ARIES_UPDATE_REHEARSAL_GO_FILE` holds the check until the workflow has the
//! daemon running; `ARIES_UPDATE_REHEARSAL_LOG` receives one JSON line per
//! step, which the workflow reads back.

use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Url, Wry};
use tauri_plugin_updater::UpdaterExt;

const ENDPOINT_ENV: &str = "ARIES_UPDATE_REHEARSAL_ENDPOINT";
const GO_FILE_ENV: &str = "ARIES_UPDATE_REHEARSAL_GO_FILE";
const LOG_ENV: &str = "ARIES_UPDATE_REHEARSAL_LOG";
const GO_FILE_WAIT: Duration = Duration::from_secs(15 * 60);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub fn start(app: &AppHandle<Wry>) {
    let Ok(endpoint) = std::env::var(ENDPOINT_ENV) else {
        return;
    };
    let log = std::env::var_os(LOG_ENV).map(PathBuf::from);
    let go_file = std::env::var_os(GO_FILE_ENV).map(PathBuf::from);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();
        record(log.as_deref(), "started", &current);
        if let Some(go_file) = go_file.as_deref() {
            if !wait_for(go_file).await {
                record(log.as_deref(), "error", "go file never appeared");
                return;
            }
        }
        if let Err(error) = run(&app, &endpoint, log.as_deref()).await {
            record(log.as_deref(), "error", &error);
        }
    });
}

async fn wait_for(path: &Path) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < GO_FILE_WAIT {
        if path.exists() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    path.exists()
}

async fn run(app: &AppHandle<Wry>, endpoint: &str, log: Option<&Path>) -> Result<(), String> {
    let endpoint = Url::parse(endpoint).map_err(|error| format!("endpoint: {error}"))?;
    record(log, "checking", endpoint.as_str());
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(UPDATE_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| format!("check: {error}"))?;
    let Some(update) = update else {
        record(log, "no-update", &app.package_info().version.to_string());
        return Ok(());
    };
    record(log, "update-available", &update.version);
    // download() verifies the minisign signature against plugins.updater.pubkey.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| format!("download: {error}"))?;
    record(log, "downloaded-verified", &bytes.len().to_string());
    record(log, "installing", &update.version);
    // Starts the installer (/P /R /UPDATE) and exits the process on success.
    update
        .install(bytes)
        .map_err(|error| format!("install: {error}"))
}

fn record(log: Option<&Path>, step: &str, detail: &str) {
    log::warn!("update rehearsal: {step}: {detail}");
    let Some(path) = log else {
        return;
    };
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let line = serde_json::json!({
        "ms": millis,
        "pid": std::process::id(),
        "step": step,
        "detail": detail,
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}
