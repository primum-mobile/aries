// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! CI licence bypass (Windows release rehearsal only).
//!
//! Compiled in only with the `ci-licence-bypass` Cargo feature, which
//! `.github/workflows/windows-release-rehearsal.yml` enables for throwaway
//! `*-rehearsal.N` builds; build.rs refuses the feature for any other version,
//! and release workflows, scripts and Tauri configs never pass it
//! (`tests/test_windows_ci_licence_bypass.py`). Without the feature this file
//! is not compiled and the licence gate is exactly the release gate.
//!
//! Even in a rehearsal build it does nothing unless the process environment
//! has `ARIES_CI_LICENCE_BYPASS=1`, which only
//! `scripts/windows_rehearsal/run-app-scenarios.ps1` sets. The shell then
//! reports the licence as not required (`licensing::license_required`), so
//! it starts the daemon and the page skips the licence dialog, as an
//! unlicensed development build does. The lease, credential and server code
//! is untouched; no lease is faked and nothing is written.
//!
//! The same script drives the page over the Chrome DevTools Protocol. The
//! WebView2 loader ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and the
//! AdditionalBrowserArguments policy when the app passes its own arguments
//! (wry always does), so with `ARIES_CI_WEBVIEW_ARGS` set as well (the
//! debugging port, and `--force-device-scale-factor` when the runner cannot
//! change the display scale) the config windows get wry's default arguments
//! followed by those.

const ENV: &str = "ARIES_CI_LICENCE_BYPASS";
const WEBVIEW_ARGS_ENV: &str = "ARIES_CI_WEBVIEW_ARGS";
const CRASH_ENV: &str = "ARIES_CI_CRASH";
// wry's WebView2 defaults (webview2/mod.rs), which explicit arguments replace.
const WRY_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// True when this rehearsal build was started with the bypass switched on.
pub(crate) fn active() -> bool {
    std::env::var(ENV).as_deref() == Ok("1")
}

/// Appends the scenario script's WebView2 arguments to the windows from the
/// Tauri config, when the bypass is on and arguments are given.
pub(crate) fn open_webview_debugging(context: &mut tauri::Context<tauri::Wry>) {
    if !active() {
        return;
    }
    let Some(extra) = std::env::var(WEBVIEW_ARGS_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    for window in &mut context.config_mut().app.windows {
        window.additional_browser_args = Some(format!("{WRY_DEFAULT_ARGS} {}", extra.trim()));
    }
}

/// The same arguments for windows the app builds at run time (Settings, the
/// chart editor). WebView2 shares one browser process per user data folder,
/// and a second WebView created with different arguments fails to start, so
/// without this those windows never appear in a rehearsal run.
pub(crate) fn runtime_webview_args() -> Option<String> {
    if !active() {
        return None;
    }
    let extra = std::env::var(WEBVIEW_ARGS_ENV).ok()?;
    let extra = extra.trim();
    (!extra.is_empty()).then(|| format!("{WRY_DEFAULT_ARGS} {extra}"))
}

/// Crashes on purpose when the scenario script sets `ARIES_CI_CRASH` (with
/// the bypass on): `panic` panics on the main thread, `fault` raises an
/// access violation. The crash-dump scenario then looks for the minidumps.
pub(crate) fn crash_if_requested() {
    if !active() {
        return;
    }
    match std::env::var(CRASH_ENV).as_deref() {
        Ok("panic") => panic!("rehearsal crash requested ({CRASH_ENV}=panic)"),
        Ok("fault") => {
            use windows::Win32::Foundation::EXCEPTION_ACCESS_VIOLATION;
            use windows::Win32::System::Diagnostics::Debug::RaiseException;
            // SAFETY: raises a non-continuable exception that nothing
            // handles; the process ends after the unhandled-exception filter.
            unsafe { RaiseException(EXCEPTION_ACCESS_VIOLATION.0 as u32, 1, None) };
        }
        _ => {}
    }
}
