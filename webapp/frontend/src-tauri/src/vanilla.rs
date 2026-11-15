// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Vanilla mode: run Aries exactly as a fresh install, without reading or
//! writing the user's own setup.
//!
//! A vanilla launch gets an empty settings folder and chart folder (deleted
//! and recreated every launch) and a webview data store of its own, so
//! local-storage preferences start empty too. The licence lives in the app
//! config folder and the keychain, outside all of these, so it carries over.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager, Wry};

pub(crate) const LAUNCH_ARG: &str = "--vanilla";
const LAUNCH_ENV: &str = "ARIES_VANILLA";
const ROOT_DIR: &str = "vanilla";
#[cfg(target_vendor = "apple")]
const STORES_FILE: &str = "vanilla-webview-stores.json";
// The daemon copies a legacy Morinus folder and, in dev, the installed
// settings into an empty settings folder. These markers tell it a fresh
// install has nothing to import.
const SETTINGS_MARKERS: [(&str, &str); 2] = [
    (".migrated-from-morinus", "Vanilla mode: start empty, import nothing.\n"),
    (".seeded-from-installed", "Vanilla mode: start empty, import nothing.\n"),
];

pub(crate) struct Session {
    pub opts_dir: PathBuf,
    pub charts_dir: PathBuf,
    #[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
    pub store_id: [u8; 16],
    #[cfg_attr(target_vendor = "apple", allow(dead_code))]
    pub webview_dir: PathBuf,
}

static SESSION: OnceLock<Option<Session>> = OnceLock::new();

/// Restart target chosen by the user, consumed when the app exits.
#[derive(Default)]
pub(crate) struct RelaunchIntent(pub Mutex<Option<bool>>);

fn requested() -> bool {
    std::env::args().skip(1).any(|arg| arg == LAUNCH_ARG)
        || std::env::var(LAUNCH_ENV).is_ok_and(|value| value.trim() == "1")
}

pub(crate) fn session() -> Option<&'static Session> {
    SESSION.get().and_then(Option::as_ref)
}

pub(crate) fn active() -> bool {
    session().is_some()
}

/// Called once at startup, before any webview or the daemon exists.
pub(crate) fn prepare(app: &AppHandle<Wry>) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let session = if requested() { Some(fresh_session(&root.join(ROOT_DIR))?) } else { None };
    #[cfg(target_vendor = "apple")]
    retire_previous_stores(app, &root, session.as_ref().map(|session| session.store_id));
    SESSION.set(session).map_err(|_| "vanilla mode prepared twice".to_string())
}

fn fresh_session(root: &Path) -> Result<Session, String> {
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| format!("could not clear {}: {error}", root.display()))?;
    }
    let opts_dir = root.join("Opts");
    let charts_dir = root.join("Charts");
    let webview_dir = root.join("WebView");
    for dir in [&opts_dir, &charts_dir, &webview_dir] {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    for (name, text) in SETTINGS_MARKERS {
        fs::write(opts_dir.join(name), text).map_err(|error| error.to_string())?;
    }
    let mut store_id = [0_u8; 16];
    getrandom::getrandom(&mut store_id).map_err(|_| "could not create a vanilla webview store".to_string())?;
    // A valid version 4 UUID, as WebKit expects for a data store identifier.
    store_id[6] = (store_id[6] & 0x0f) | 0x40;
    store_id[8] = (store_id[8] & 0x3f) | 0x80;
    Ok(Session { opts_dir, charts_dir, store_id, webview_dir })
}

/// Every vanilla launch gets a new store; the previous ones are deleted once
/// no webview uses them, i.e. on the next launch of either kind.
#[cfg(target_vendor = "apple")]
fn retire_previous_stores(app: &AppHandle<Wry>, root: &Path, current: Option<[u8; 16]>) {
    let path = root.join(STORES_FILE);
    let previous: Vec<[u8; 16]> = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let keep: Vec<[u8; 16]> = current.into_iter().collect();
    if let Err(error) = fs::create_dir_all(root)
        .and_then(|_| fs::write(&path, serde_json::to_string(&keep).unwrap_or_else(|_| "[]".into())))
    {
        log::warn!("could not record the vanilla webview store: {error}");
    }
    for id in previous.into_iter().filter(|id| Some(*id) != current) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle.remove_data_store(id).await {
                log::warn!("could not remove an old vanilla webview store: {error}");
            }
        });
    }
}

/// Give a webview the vanilla store, so all windows of one launch share it.
pub(crate) fn isolate<'a, M: Manager<Wry>>(
    builder: tauri::WebviewWindowBuilder<'a, Wry, M>,
) -> tauri::WebviewWindowBuilder<'a, Wry, M> {
    let Some(session) = session() else { return builder };
    #[cfg(target_vendor = "apple")]
    return builder.data_store_identifier(session.store_id);
    #[cfg(not(target_vendor = "apple"))]
    return builder.data_directory(session.webview_dir.clone());
}

/// The daemon reads settings and charts from the vanilla folders.
pub(crate) fn apply_daemon_environment(command: &mut Command) {
    let Some(session) = session() else { return };
    command
        .env("ARIES_USER_OPTS_DIR", &session.opts_dir)
        .env_remove("ARIES_USER_OPTS_DIR_HOME")
        .env("ARIES_CHARTS_DIR", &session.charts_dir)
        .env("ARIES_DEV_PROFILE", "0");
}

/// Start the next instance after this one has exited cleanly.
pub(crate) fn relaunch(app: &AppHandle<Wry>) {
    let Some(state) = app.try_state::<RelaunchIntent>() else { return };
    let Some(vanilla) = state.0.lock().ok().and_then(|mut intent| intent.take()) else { return };
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            log::warn!("could not find the Aries executable to restart: {error}");
            return;
        }
    };
    let mut command = Command::new(executable);
    command.args(std::env::args().skip(1).filter(|arg| arg != LAUNCH_ARG));
    command.env_remove(LAUNCH_ENV);
    if vanilla {
        command.arg(LAUNCH_ARG);
    }
    if let Err(error) = command.spawn() {
        log::warn!("could not restart Aries: {error}");
    }
}

pub(crate) fn clear_relaunch(app: &AppHandle<Wry>) {
    if let Some(state) = app.try_state::<RelaunchIntent>() {
        if let Ok(mut intent) = state.0.lock() {
            *intent = None;
        }
    }
}

#[tauri::command]
pub(crate) fn vanilla_mode() -> bool {
    active()
}

/// Restart into (or out of) vanilla mode through the normal quit flow, so
/// unsaved charts are offered for saving first.
#[tauri::command]
pub(crate) fn restart_vanilla_mode(app: AppHandle<Wry>, vanilla: bool) -> Result<(), String> {
    let state = app.try_state::<RelaunchIntent>().ok_or("restart unavailable")?;
    *state.0.lock().map_err(|error| error.to_string())? = Some(vanilla);
    crate::request_quit_preflight(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_session_replaces_previous_contents_and_marks_settings() {
        let root = std::env::temp_dir().join(format!("aries-vanilla-test-{}", std::process::id()));
        fs::create_dir_all(root.join("Opts")).unwrap();
        fs::write(root.join("Opts").join("settings.json"), "{}").unwrap();
        let session = fresh_session(&root).unwrap();
        assert!(!session.opts_dir.join("settings.json").exists());
        for (name, _) in SETTINGS_MARKERS {
            assert!(session.opts_dir.join(name).exists());
        }
        assert!(session.charts_dir.is_dir());
        assert_eq!(session.store_id[6] >> 4, 4);
        fs::remove_dir_all(root).unwrap();
    }
}
