// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::{
    fmt::Write as _,
    fs::File,
    io::{Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const LOG_TAIL_BYTES: u64 = 64 * 1024;
const MAX_EVENTS_PER_LOG: usize = 40;
pub const ENABLED: bool = cfg!(any(windows, target_os = "macos"));

pub const WEBVIEW_DIAGNOSTICS: &str = r#"
(function () {
    const record = (kind) => {
        void window.__TAURI_INTERNALS__?.invoke("record_bug_report_error", { kind }).catch(() => {});
    };
    window.addEventListener("error", (event) => {
        if (event instanceof ErrorEvent) record("scriptError");
    });
    window.addEventListener("unhandledrejection", () => record("unhandledRejection"));
})();
"#;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrontendError {
    ScriptError,
    UnhandledRejection,
}

#[tauri::command]
pub fn record_bug_report_error(kind: FrontendError) {
    if ENABLED {
        let event = match kind {
            FrontendError::ScriptError => "Frontend script error",
            FrontendError::UnhandledRejection => "Frontend unhandled promise rejection",
        };
        log::error!(target: "aries_bug_report", "{event}");
    }
}

// Share only fixed event labels and numeric codes. Raw lines and traceback
// messages can contain chart data, request contents, or local paths.
fn native_event(line: &str) -> Option<String> {
    let (date, rest) = line.strip_prefix('[')?.split_once("][")?;
    let (time, rest) = rest.split_once("][")?;
    if date.len() != 10
        || time.len() != 8
        || !date
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'-')
        || !time
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b':')
    {
        return None;
    }
    let (target, rest) = rest.split_once("][")?;
    let (level, message) = rest.split_once("] ")?;
    let event = match target {
        "aries_bug_report" => match message {
            "Frontend script error" => "Frontend script error",
            "Frontend unhandled promise rejection" => "Frontend unhandled promise rejection",
            _ => return None,
        },
        "aries_lib" if matches!(level, "WARN" | "ERROR") => [
            (
                "aries daemon exited unexpectedly:",
                "Python daemon exited unexpectedly",
            ),
            (
                "failed to restart aries daemon:",
                "Python daemon restart failed",
            ),
            (
                "failed to start aries daemon",
                "Python daemon startup failed",
            ),
            (
                "failed to open daemon ",
                "Python daemon log could not be opened",
            ),
            (
                "failed to install daemon native menu",
                "Native menu setup failed",
            ),
        ]
        .into_iter()
        .find_map(|(prefix, event)| message.starts_with(prefix).then_some(event))?,
        _ => return None,
    };
    Some(format!("{date} {time} UTC · {event}"))
}

fn daemon_event(line: &str) -> Option<String> {
    if line.starts_with("INFO:") {
        let (_, status) = line.rsplit_once("\" ")?;
        let code = status
            .split_ascii_whitespace()
            .next()?
            .parse::<u16>()
            .ok()?;
        return (500..600).contains(&code).then(|| format!("HTTP {code}"));
    }
    if line.starts_with("ERROR:") || line.starts_with("CRITICAL:") {
        return Some("Daemon error".into());
    }
    let (exception, _) = line.split_once(':')?;
    match exception {
        "AssertionError"
        | "AttributeError"
        | "FileNotFoundError"
        | "ImportError"
        | "IndexError"
        | "KeyError"
        | "MemoryError"
        | "ModuleNotFoundError"
        | "OSError"
        | "PermissionError"
        | "RuntimeError"
        | "TimeoutError"
        | "TypeError"
        | "ValueError"
        | "ZeroDivisionError" => Some(format!("Python {exception}")),
        _ => None,
    }
}

fn read_log_tail(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let start = file.metadata()?.len().saturating_sub(LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes)?;
    let contents = String::from_utf8_lossy(&bytes);
    if start == 0 {
        Ok(contents.into_owned())
    } else {
        Ok(contents
            .split_once('\n')
            .map_or("", |(_, rest)| rest)
            .to_owned())
    }
}

fn append_events(
    report: &mut String,
    directory: &Path,
    file: &str,
    parse: fn(&str) -> Option<String>,
) {
    let Ok(log) = read_log_tail(&directory.join(file)) else {
        return;
    };
    let events: Vec<_> = log
        .lines()
        .rev()
        .filter_map(parse)
        .take(MAX_EVENTS_PER_LOG)
        .collect();
    for event in events.iter().rev() {
        report.push_str(event);
        report.push('\n');
    }
}

fn os_version() -> String {
    #[cfg(windows)]
    {
        let version = windows_version::OsVersion::current();
        format!("{}.{}.{}", version.major, version.minor, version.build)
    }
    #[cfg(target_os = "macos")]
    {
        objc2::rc::autoreleasepool(|_| {
            let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
            format!(
                "{}.{}.{}",
                version.majorVersion, version.minorVersion, version.patchVersion
            )
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    String::new()
}

fn webview_version() -> Option<String> {
    #[cfg(target_os = "macos")]
    let version = objc2::rc::autoreleasepool(|_| tauri::webview_version());
    #[cfg(not(target_os = "macos"))]
    let version = tauri::webview_version();
    version.ok()
}

fn build_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSBundle, NSString};
        objc2::rc::autoreleasepool(|_| {
            // The Mac packager uses this same stamp to verify the built bundle.
            NSBundle::mainBundle()
                .objectForInfoDictionaryKey(&NSString::from_str("AriesBetaBuildId"))?
                .downcast::<NSString>()
                .ok()
                .map(|id| id.to_string())
        })
    }
    #[cfg(not(target_os = "macos"))]
    option_env!("ARIES_BETA_BUILD_ID").map(str::to_owned)
}

fn collect_report(app: &AppHandle, description: &str) -> Result<String, String> {
    if !ENABLED || description.chars().count() > 2000 {
        return Err("bug_report_unavailable".into());
    }
    let (system, webview_name) = if cfg!(windows) {
        ("Windows", "WebView2")
    } else {
        ("macOS", "WebKit")
    };
    let mut report = format!("Aries {system} beta bug report\n");
    let package = app.package_info();
    let version = option_env!("ARIES_RELEASE_VERSION")
        .filter(|version| !version.is_empty())
        .map_or_else(|| package.version.to_string(), str::to_owned);
    writeln!(report, "Aries {version} · {}", std::env::consts::ARCH).expect("write to string");
    if let Some(build) = build_id()
        .filter(|id| !id.is_empty() && id.len() <= 128 && !id.chars().any(char::is_control))
    {
        writeln!(report, "Build {build}").expect("write to string");
    }
    writeln!(report, "{system} {}", os_version()).expect("write to string");
    if let Some(webview) = webview_version() {
        if let Some(version) = webview.split_ascii_whitespace().next().filter(|version| {
            version.len() <= 40
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'.')
        }) {
            writeln!(report, "{webview_name} {version}").expect("write to string");
        }
    }
    if !description.trim().is_empty() {
        writeln!(report, "\nWhat happened\n{}", description.trim()).expect("write to string");
    }
    let Some(directory) = super::app_log_dir(app) else {
        return Ok(report);
    };
    let native_file = super::diagnostics::shell_log_file_name(&package.name);
    report.push_str("\nRecent shell and frontend events (UTC)\n");
    append_events(&mut report, &directory, &native_file, native_event);
    report.push_str("\nRecent Python daemon errors\n");
    append_events(
        &mut report,
        &directory,
        "aries-daemon.err.log",
        daemon_event,
    );
    append_events(
        &mut report,
        &directory,
        "aries-daemon.out.log",
        daemon_event,
    );
    Ok(report)
}

#[tauri::command]
pub async fn send_bug_report(app: AppHandle, description: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let report = collect_report(&app, &description)?;
        super::licensing::submit_bug_report(&app, &report)
    })
    .await
    .map_err(|_| "bug_report_send_failed".to_owned())?
}

fn zip_report(report: &str) -> zip::result::ZipResult<Vec<u8>> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    archive.start_file("report.txt", zip::write::SimpleFileOptions::default())?;
    archive.write_all(report.as_bytes())?;
    Ok(archive.finish()?.into_inner())
}

#[tauri::command]
pub async fn save_bug_report(
    app: AppHandle,
    window: WebviewWindow,
    description: String,
) -> Result<bool, String> {
    if !ENABLED {
        return Err("bug_report_unavailable".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .set_file_name("Aries-bug-report.zip")
        .add_filter("ZIP", &["zip"])
        .save_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive.await.map_err(|_| "bug_report_save_failed")? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|_| "bug_report_save_failed")?;
    tauri::async_runtime::spawn_blocking(move || {
        let report = collect_report(&app, &description)?;
        let archive = zip_report(&report).map_err(|_| "bug_report_save_failed")?;
        std::fs::write(path, archive).map_err(|_| "bug_report_save_failed")?;
        Ok(true)
    })
    .await
    .map_err(|_| "bug_report_save_failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_system_versions_are_available_for_reports() {
        assert_eq!(os_version().split('.').count(), 3);
        assert!(webview_version().is_some());
    }

    #[test]
    fn only_known_events_survive_log_export() {
        assert_eq!(
            native_event("[2026-11-09][11:30:01][aries_lib][WARN] aries daemon exited unexpectedly: sensitive path"),
            Some("2026-11-09 11:30:01 UTC · Python daemon exited unexpectedly".into())
        );
        assert_eq!(
            native_event("[2026-11-09][11:30:01][aries_lib][ERROR] birth chart details"),
            None
        );
        assert_eq!(
            daemon_event("ValueError: secret chart contents"),
            Some("Python ValueError".into())
        );
        assert_eq!(
            daemon_event("  File \"C:/Users/Person/private.py\", line 123"),
            None
        );
        assert_eq!(
            daemon_event("INFO: 127.0.0.1 - \"POST /api/chart?secret=foo HTTP/1.1\" 500 Internal Server Error"),
            Some("HTTP 500".into())
        );
    }

    #[test]
    fn zip_contains_only_the_generated_report() {
        let bytes = zip_report("sample diagnostics").unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 1);
        let mut contents = String::new();
        archive
            .by_name("report.txt")
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert_eq!(contents, "sample diagnostics");
    }
}
