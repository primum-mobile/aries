// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
#[cfg(unix)]
use std::sync::atomic::AtomicU64;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{
    CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::utils::config::Color;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, Wry,
};
#[cfg(unix)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use tokio::net::UnixStream;

mod licensing;
mod native_menu_readiness;
use native_menu_readiness::NativeMenuReadiness;
#[cfg(target_os = "windows")]
mod windows_titlebar;

struct DaemonProcess {
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
    access_allowed: AtomicBool,
    launch_lock: Mutex<()>,
    http_agent: ureq::Agent,
    native_transport: NativeDaemonTransport,
    port: u16,
    daemon_base_url: String,
    daemon_token: String,
    native_started_at: Instant,
}

impl DaemonProcess {
    fn new(
        port: u16,
        daemon_base_url: String,
        daemon_token: String,
        native_started_at: Instant,
        access_allowed: bool,
    ) -> Self {
        Self {
            child: Mutex::new(None),
            stopping: AtomicBool::new(false),
            access_allowed: AtomicBool::new(access_allowed),
            launch_lock: Mutex::new(()),
            http_agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(60))
                .build(),
            native_transport: NativeDaemonTransport::new(&daemon_token),
            port,
            daemon_base_url,
            daemon_token,
            native_started_at,
        }
    }
}

#[cfg(unix)]
const NATIVE_REQUEST_MAGIC: &[u8; 4] = b"ARQ1";
#[cfg(unix)]
const NATIVE_RESPONSE_MAGIC: &[u8; 4] = b"ARS1";
#[cfg(unix)]
const NATIVE_RESPONSE_HEADER_BYTES: usize = 10;
#[cfg(unix)]
const NATIVE_MAX_PATH_BYTES: usize = 8 * 1024;
#[cfg(unix)]
const NATIVE_MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
#[cfg(unix)]
const NATIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[cfg(unix)]
struct NativeDaemonConnection {
    generation: u64,
    stream: Option<UnixStream>,
}

struct NativeDaemonTransport {
    #[cfg(unix)]
    socket_path: PathBuf,
    #[cfg(unix)]
    generation: AtomicU64,
    #[cfg(unix)]
    connection: tokio::sync::Mutex<NativeDaemonConnection>,
}

enum NativeTransportError {
    Unavailable(String),
    #[cfg(unix)]
    Failed(String),
}

impl NativeDaemonTransport {
    fn new(daemon_token: &str) -> Self {
        #[cfg(unix)]
        {
            let token_prefix = daemon_token.get(..12).unwrap_or(daemon_token);
            let socket_path = std::env::temp_dir().join(format!(
                "aries-native-{}-{token_prefix}.sock",
                std::process::id()
            ));
            Self {
                socket_path,
                generation: AtomicU64::new(0),
                connection: tokio::sync::Mutex::new(NativeDaemonConnection {
                    generation: 0,
                    stream: None,
                }),
            }
        }
        #[cfg(not(unix))]
        {
            let _ = daemon_token;
            Self {}
        }
    }

    fn socket_path(&self) -> Option<&Path> {
        #[cfg(unix)]
        {
            Some(&self.socket_path)
        }
        #[cfg(not(unix))]
        {
            None
        }
    }

    fn mark_daemon_starting(&self) {
        #[cfg(unix)]
        {
            self.generation.fetch_add(1, Ordering::SeqCst);
        }
    }

    async fn request(
        &self,
        request: &NativeDaemonRequest,
    ) -> Result<NativeDaemonResponse, NativeTransportError> {
        #[cfg(unix)]
        {
            self.request_unix(request).await
        }
        #[cfg(not(unix))]
        {
            let _ = request;
            Err(NativeTransportError::Unavailable(
                "native daemon sockets are unavailable on this platform".to_string(),
            ))
        }
    }

    #[cfg(unix)]
    async fn request_unix(
        &self,
        request: &NativeDaemonRequest,
    ) -> Result<NativeDaemonResponse, NativeTransportError> {
        let method = match request.method.trim().to_ascii_uppercase().as_str() {
            "GET" => 0_u8,
            "POST" => 1_u8,
            _ => {
                return Err(NativeTransportError::Failed(
                    "native daemon request method is unsupported".to_string(),
                ));
            }
        };
        let path = request.path.as_bytes();
        let body = request.body.as_deref().unwrap_or("").as_bytes();
        if path.is_empty() || path.len() > NATIVE_MAX_PATH_BYTES || path.len() > u16::MAX as usize {
            return Err(NativeTransportError::Failed(
                "native daemon request path is too large".to_string(),
            ));
        }
        if body.len() > NATIVE_MAX_BODY_BYTES || body.len() > u32::MAX as usize {
            return Err(NativeTransportError::Failed(
                "native daemon request body is too large".to_string(),
            ));
        }

        let generation = self.generation.load(Ordering::SeqCst);
        let mut connection = self.connection.lock().await;
        if connection.generation != generation {
            connection.stream = None;
            connection.generation = generation;
        }
        if connection.stream.is_none() {
            let stream = match tokio::time::timeout(
                NATIVE_REQUEST_TIMEOUT,
                UnixStream::connect(&self.socket_path),
            )
            .await
            {
                Ok(Ok(stream)) => stream,
                Ok(Err(error)) => {
                    return Err(NativeTransportError::Unavailable(format!(
                        "native daemon socket is unavailable: {error}"
                    )));
                }
                Err(_) => {
                    return Err(NativeTransportError::Unavailable(
                        "native daemon socket connection timed out".to_string(),
                    ));
                }
            };
            connection.stream = Some(stream);
        }
        let stream = connection
            .stream
            .as_mut()
            .expect("native daemon stream was just connected");

        let mut frame = Vec::with_capacity(11 + path.len() + body.len());
        frame.extend_from_slice(NATIVE_REQUEST_MAGIC);
        frame.push(method);
        frame.extend_from_slice(&(path.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
        frame.extend_from_slice(path);
        frame.extend_from_slice(body);
        let exchange = async {
            stream
                .write_all(&frame)
                .await
                .map_err(|error| format!("native daemon request write failed: {error}"))?;
            let mut header = [0_u8; NATIVE_RESPONSE_HEADER_BYTES];
            stream
                .read_exact(&mut header)
                .await
                .map_err(|error| format!("native daemon response header failed: {error}"))?;
            if &header[..4] != NATIVE_RESPONSE_MAGIC {
                return Err("native daemon response protocol is invalid".to_string());
            }
            let status = u16::from_be_bytes([header[4], header[5]]);
            let body_length =
                u32::from_be_bytes([header[6], header[7], header[8], header[9]]) as usize;
            if body_length > NATIVE_MAX_BODY_BYTES {
                return Err("native daemon response is too large".to_string());
            }
            let mut response_body = vec![0_u8; body_length];
            stream
                .read_exact(&mut response_body)
                .await
                .map_err(|error| format!("native daemon response body failed: {error}"))?;
            let body = String::from_utf8(response_body)
                .map_err(|error| format!("native daemon response is not UTF-8: {error}"))?;
            Ok::<(u16, String), String>((status, body))
        };
        let (status, body) = match tokio::time::timeout(NATIVE_REQUEST_TIMEOUT, exchange).await {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                connection.stream = None;
                return Err(NativeTransportError::Failed(error));
            }
            Err(_) => {
                connection.stream = None;
                return Err(NativeTransportError::Failed(
                    "native daemon request timed out".to_string(),
                ));
            }
        };
        Ok(NativeDaemonResponse {
            status,
            content_length: body.len(),
            body,
            transport: "unix-ipc",
        })
    }
}

// App-quit guard (policy-chart-lifecycle §3; wx onClose/onExit, morin.py:15615,
// 15638): the first main-window CloseRequested is intercepted so the React shell
// can run quit-preflight + the Save/Discard/Cancel modal. Once the shell signals
// clear, it calls confirm_quit, which flips this flag and re-issues the close so
// the next CloseRequested falls through to real teardown.
struct QuitConfirmed(Mutex<bool>);

struct NativeMenuCommandIds(Mutex<HashSet<String>>);

#[derive(Debug, Deserialize, Serialize)]
struct MainWindowFrameState {
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    width: f64,
    height: f64,
}

const CHART_PICKER_WINDOW: &str = "chart-picker";
const SETTINGS_WINDOW: &str = "settings";
const CHART_EDITOR_WINDOW: &str = "chart-editor";
const CHART_EDITOR_MIN_WIDTH: f64 = 600.0;
const CHART_EDITOR_MIN_HEIGHT: f64 = 480.0;
const CHART_PICKER_INITIAL_WIDTH: f64 = 552.0;
const CHART_PICKER_MIN_WIDTH: f64 = 276.0;
const DAEMON_READY_TIMEOUT_SECS: u64 = 60;
const APP_ABOUT_MENU_ID: &str = "menu.app.about";
const ARIES_ABOUT_COMMAND_ID: &str = "menu.help.about";
// Last-resort fallback only. The LIVE menu is fetched from the daemon at startup
// (see setup() -> fetch_native_menu_manifest), so editing the JSON file or
// dropping in a corpus pack updates the menu with NO Rust rebuild. This baked
// copy is used only if the daemon fetch fails, so the app is never menu-less.
const NATIVE_MENU_MANIFEST_JSON: &str = include_str!("../native-menu-manifest.json");
const MAIN_WINDOW_STATE_FILE: &str = "main-window-size.json";
const MAIN_WINDOW_MIN_WIDTH: f64 = 1024.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 720.0;
const DESKTOP_WEBVIEW_GUARD_SCRIPT: &str = r#"
(function () {
  if (window.__ARIES_DESKTOP_WEBVIEW_GUARD__) return;
  Object.defineProperty(window, "__ARIES_DESKTOP_WEBVIEW_GUARD__", {
    value: true,
    configurable: false,
    writable: false
  });
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  }, true);
})();
"#;
#[cfg(all(target_os = "macos", not(target_arch = "x86_64")))]
const MAIN_TRAFFIC_LIGHT_X: f64 = 19.0;
#[cfg(all(target_os = "macos", not(target_arch = "x86_64")))]
const MAIN_TRAFFIC_LIGHT_DIAMETER: f64 = 12.0;
#[cfg(all(target_os = "macos", not(target_arch = "x86_64")))]
const MAIN_TRAFFIC_LIGHT_CENTER_GAP: f64 = 20.0;
#[cfg(all(target_os = "macos", not(target_arch = "x86_64")))]
const COMPACT_TRAFFIC_LIGHT_TAG_BASE: isize = 741_200;

#[derive(Debug, Deserialize)]
struct NativeMenuManifest {
    menus: Vec<NativeMenuNode>,
}

#[derive(Debug, Deserialize)]
struct NativeMenuNode {
    #[serde(rename = "type")]
    node_type: String,
    id: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,
    checked: Option<bool>,
    accelerator: Option<String>,
    #[serde(default)]
    children: Vec<NativeMenuNode>,
}

#[derive(Debug, Deserialize)]
struct NativeMenuEnabledState {
    id: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct NativeMenuCheckedState {
    id: String,
    checked: bool,
}

#[derive(Debug, Deserialize)]
struct RecentChartMenuEntry {
    id: String,
    label: String,
}

#[derive(Debug, Deserialize)]
struct WheelStyleMenuEntry {
    id: String,
    label: String,
    checked: bool,
}

#[derive(Debug, Deserialize)]
struct NativeMenuLabelState {
    id: String,
    label: String,
}

impl NativeMenuCommandIds {
    fn from_manifest(manifest: &NativeMenuManifest) -> Self {
        Self(Mutex::new(native_menu_command_ids(manifest)))
    }

    fn replace_from_manifest(&self, manifest: &NativeMenuManifest) -> Result<(), String> {
        *self.0.lock().map_err(|e| e.to_string())? = native_menu_command_ids(manifest);
        Ok(())
    }

    fn replace_recent_entries(&self, ids: Vec<String>) -> Result<(), String> {
        let mut commands = self.0.lock().map_err(|e| e.to_string())?;
        commands.retain(|id| !id.starts_with("menu.recent-charts.entry:"));
        commands.extend(ids);
        Ok(())
    }

    fn replace_wheel_styles(&self, ids: Vec<String>) -> Result<(), String> {
        let mut commands = self.0.lock().map_err(|e| e.to_string())?;
        commands.retain(|id| !id.starts_with("quick.options.wheel-preset:"));
        commands.extend(ids);
        Ok(())
    }

    fn contains(&self, id: &str) -> Result<bool, String> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.contains(id))
    }
}

#[derive(Clone, Serialize)]
struct ChartPickerWindowPerf {
    phase: String,
    ms: f64,
    navigated: bool,
    created: bool,
    visible: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct FrontendPerfEvent {
    name: String,
    at: f64,
    detail: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeDaemonRequest {
    method: String,
    path: String,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDaemonResponse {
    status: u16,
    body: String,
    content_length: usize,
    transport: &'static str,
}

const RECENT_CHARTS_SUBMENU_ID: &str = "menu.recent-charts";

fn frontend_perf_enabled() -> bool {
    matches!(std::env::var("ARIES_TAURI_PERF").ok().as_deref(), Some("1"))
}

fn speedlog_enabled() -> bool {
    cfg!(debug_assertions) || matches!(std::env::var("ARIES_SPEEDLOG").ok().as_deref(), Some("1"))
}

fn speedlog_path() -> PathBuf {
    std::env::temp_dir().join("aries-speedlog.jsonl")
}

fn append_speedlog(event: &FrontendPerfEvent) -> Result<(), String> {
    let recorded_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let line = serde_json::to_string(&serde_json::json!({
        "recordedAtUnixMs": recorded_at_unix_ms,
        "event": event,
    }))
    .map_err(|error| error.to_string())?;
    let path = speedlog_path();
    if fs::metadata(&path)
        .map(|metadata| metadata.len() >= 5 * 1024 * 1024)
        .unwrap_or(false)
    {
        let rotated = path.with_extension("jsonl.1");
        let _ = fs::remove_file(&rotated);
        fs::rename(&path, rotated).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn install_macos_scrollbar_policy() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    let key = NSString::from_str("AppleShowScrollBars");
    let value = NSString::from_str("WhenScrolling");
    let value_obj: &AnyObject = value.as_ref();
    unsafe {
        defaults.setObject_forKey(Some(value_obj), key.as_ref());
    }
}

#[cfg(not(target_os = "macos"))]
fn install_macos_scrollbar_policy() {}

fn record_native_startup_perf(name: &str, started_at: Instant, detail: serde_json::Value) {
    if !frontend_perf_enabled() {
        return;
    }
    let ms_since_native_run = started_at.elapsed().as_secs_f64() * 1_000.0;
    let event = serde_json::json!({
        "name": format!("startup-{name}"),
        "at": ms_since_native_run,
        "detail": {
            "native": true,
            "msSinceNativeRun": ms_since_native_run,
            "detail": detail,
        },
    });
    match serde_json::to_string(&event) {
        Ok(raw) => log::info!("frontend-perf {raw}"),
        Err(error) => log::warn!("failed to encode native startup perf event {name}: {error}"),
    }
}

fn main_window_state_path(app: &AppHandle<Wry>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(MAIN_WINDOW_STATE_FILE))
}

fn legacy_morinus_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Morinus")
        });
    }
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData").join("Roaming"))
            })
            .map(|base| base.join("Morinus"));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .map(|base| base.join("Morinus"));
    }
}

fn migrate_legacy_main_window_state(app: &AppHandle<Wry>) -> Result<(), String> {
    let current = main_window_state_path(app)?;
    if current.exists() {
        return Ok(());
    }
    let Some(legacy_dir) = legacy_morinus_config_dir() else {
        return Ok(());
    };
    let legacy = legacy_dir.join(MAIN_WINDOW_STATE_FILE);
    if !legacy.is_file() {
        return Ok(());
    }
    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&legacy, &current)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn restore_main_window_frame(window: &WebviewWindow<Wry>) -> Result<(), String> {
    let path = main_window_state_path(&window.app_handle())?;
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let state: MainWindowFrameState = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !state.width.is_finite() || !state.height.is_finite() {
        return Ok(());
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        if x.is_finite() && y.is_finite() {
            window
                .set_position(Position::Logical(LogicalPosition { x, y }))
                .map_err(|e| e.to_string())?;
        }
    }
    let width = state.width.max(MAIN_WINDOW_MIN_WIDTH);
    let height = state.height.max(MAIN_WINDOW_MIN_HEIGHT);
    window
        .set_size(Size::Logical(LogicalSize { width, height }))
        .map_err(|e| e.to_string())
}

fn save_main_window_frame(window: &Window<Wry>) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let position = window
        .outer_position()
        .ok()
        .map(|position| position.to_logical::<f64>(scale));
    let state = MainWindowFrameState {
        x: position.map(|position| position.x.round()),
        y: position.map(|position| position.y.round()),
        width: (f64::from(size.width) / scale)
            .round()
            .max(MAIN_WINDOW_MIN_WIDTH),
        height: (f64::from(size.height) / scale)
            .round()
            .max(MAIN_WINDOW_MIN_HEIGHT),
    };
    let path = main_window_state_path(&window.app_handle())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn choose_daemon_port() -> std::io::Result<u16> {
    if cfg!(debug_assertions) {
        return Ok(8765);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn hex_token(bytes: &[u8]) -> String {
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(token, "{byte:02x}");
    }
    token
}

fn generate_daemon_token() -> String {
    let mut bytes = [0_u8; 32];
    if getrandom::getrandom(&mut bytes).is_ok() {
        return hex_token(&bytes);
    }
    let fallback = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", std::process::id(), fallback)
}

fn daemon_parent_pid() -> String {
    std::process::id().to_string()
}

const TAURI_DAEMON_CORS_ORIGINS: &str =
    "http://tauri.localhost,https://tauri.localhost,tauri://localhost";
const DEV_DAEMON_CORS_ORIGINS: &str = "http://127.0.0.1:3000,http://localhost:3000,http://tauri.localhost,https://tauri.localhost,tauri://localhost";
const STYLE_LAB_DEV_ORIGINS: &str = "http://127.0.0.1:3010,http://localhost:3010";

fn daemon_cors_origins() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_DAEMON_CORS_ORIGINS
    } else {
        TAURI_DAEMON_CORS_ORIGINS
    }
}

fn write_dev_daemon_connection(
    base_dir: &Path,
    port: u16,
    daemon_token: &str,
) -> std::io::Result<()> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    let directory = base_dir.join("webapp").join("frontend").join(".tmp");
    fs::create_dir_all(&directory)?;
    let path = directory.join("tauri-daemon.json");
    let temporary = directory.join(".tauri-daemon.json.tmp");
    let payload = serde_json::to_vec(&serde_json::json!({
        "url": format!("http://127.0.0.1:{port}"),
        "token": daemon_token,
        "parentPid": std::process::id(),
    }))
    .map_err(std::io::Error::other)?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(&payload)?;
    file.sync_all()?;
    fs::rename(temporary, path)
}

fn apply_daemon_environment(
    command: &mut Command,
    port: u16,
    daemon_token: &str,
    base_dir: &Path,
    native_socket_path: Option<&Path>,
) {
    if let Err(error) = write_dev_daemon_connection(base_dir, port, daemon_token) {
        log::warn!("failed to publish development daemon connection: {error}");
    }
    let cors_origins = if cfg!(debug_assertions) {
        format!("{},{}", daemon_cors_origins(), STYLE_LAB_DEV_ORIGINS)
    } else {
        daemon_cors_origins().to_string()
    };
    command
        .env("ARIES_DAEMON_PORT", port.to_string())
        .env("ARIES_DAEMON_TOKEN", daemon_token)
        .env("ARIES_DAEMON_PARENT_PID", daemon_parent_pid())
        .env("ARIES_DAEMON_BASE_DIR", base_dir)
        .env("ARIES_DAEMON_CORS_ORIGINS", cors_origins);
    if let Some(path) = native_socket_path {
        command.env("ARIES_DAEMON_SOCKET", path);
    }
}

fn attach_daemon_logs(command: &mut Command, handle: &tauri::AppHandle) {
    let log_dir = handle
        .path()
        .app_log_dir()
        .or_else(|_| handle.path().app_config_dir().map(|path| path.join("logs")));
    let Ok(log_dir) = log_dir else {
        return;
    };
    if let Err(error) = fs::create_dir_all(&log_dir) {
        log::warn!(
            "failed to create daemon log dir {}: {error}",
            log_dir.display()
        );
        return;
    }
    let stdout_path = log_dir.join("aries-daemon.out.log");
    let stderr_path = log_dir.join("aries-daemon.err.log");
    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_path)
    {
        Ok(stdout) => {
            command.stdout(Stdio::from(stdout));
        }
        Err(error) => {
            log::warn!(
                "failed to open daemon stdout log {}: {error}",
                stdout_path.display()
            );
        }
    }
    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_path)
    {
        Ok(stderr) => {
            command.stderr(Stdio::from(stderr));
        }
        Err(error) => {
            log::warn!(
                "failed to open daemon stderr log {}: {error}",
                stderr_path.display()
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn configure_daemon_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // PyInstaller produces a console executable so redirected startup errors
    // remain available in the app log. Suppress only the separate console
    // window when Tauri launches that sidecar.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_daemon_process(_command: &mut Command) {}

fn fallback_resource_dir_from_current_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents_dir = exe.parent()?.parent()?;
    let resources_dir = contents_dir.join("Resources");
    resources_dir.exists().then_some(resources_dir)
}

fn bundled_resource_dir(handle: &tauri::AppHandle) -> std::io::Result<PathBuf> {
    match handle.path().resource_dir() {
        Ok(path) => Ok(path),
        Err(error) => fallback_resource_dir_from_current_exe()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, error.to_string())),
    }
}

fn legal_document_filenames(document: &str) -> Option<&'static [&'static str]> {
    match document {
        "license" => Some(&["COPYRIGHT.txt", "LICENSE", "COPYING-GPL-3.0.txt"]),
        "notices" => Some(&["THIRD_PARTY_NOTICES.txt"]),
        _ => None,
    }
}

fn valid_native_daemon_path(path: &str) -> bool {
    (path == "/health" || path.starts_with("/api/"))
        && !path.contains("://")
        && !path.contains('\r')
        && !path.contains('\n')
}

#[cfg(test)]
mod legal_document_tests {
    use super::{legal_document_filenames, valid_native_daemon_path};

    #[test]
    fn legal_document_names_are_allowlisted() {
        assert_eq!(
            legal_document_filenames("license"),
            Some(["COPYRIGHT.txt", "LICENSE", "COPYING-GPL-3.0.txt"].as_slice())
        );
        assert_eq!(
            legal_document_filenames("notices"),
            Some(["THIRD_PARTY_NOTICES.txt"].as_slice())
        );
        assert_eq!(legal_document_filenames("../LICENSE"), None);
        assert_eq!(legal_document_filenames("DEPENDENCY_LICENSES.txt"), None);
    }

    #[test]
    fn native_daemon_paths_stay_inside_the_local_api() {
        assert!(valid_native_daemon_path("/health"));
        assert!(valid_native_daemon_path(
            "/api/workspace/navigate-key?perf=1"
        ));
        assert!(!valid_native_daemon_path(
            "https://example.com/api/workspace"
        ));
        assert!(!valid_native_daemon_path("/assets/private"));
        assert!(!valid_native_daemon_path("/api/workspace\nX-Forged: true"));
    }
}

#[tauri::command]
fn read_legal_document(app: tauri::AppHandle, document: String) -> Result<String, String> {
    let filenames =
        legal_document_filenames(&document).ok_or_else(|| "unknown legal document".to_string())?;
    let legal_dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
    } else {
        bundled_resource_dir(&app)
            .map_err(|error| format!("legal resources are unavailable: {error}"))?
            .join("legal")
    };
    let mut sections = Vec::with_capacity(filenames.len());
    for filename in filenames {
        let text = fs::read_to_string(legal_dir.join(filename))
            .map_err(|error| format!("could not read bundled {filename}: {error}"))?;
        sections.push(text.trim_end().to_string());
    }
    Ok(sections.join("\n\n"))
}

fn send_native_daemon_request(
    http_agent: &ureq::Agent,
    access_allowed: bool,
    daemon_base_url: &str,
    daemon_token: &str,
    request: NativeDaemonRequest,
) -> Result<NativeDaemonResponse, String> {
    if !access_allowed {
        return Err("aries daemon access is not licensed".to_string());
    }
    if !valid_native_daemon_path(&request.path) {
        return Err("native daemon path is outside the local API".to_string());
    }
    let method = request.method.trim().to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Err("native daemon request method is unsupported".to_string());
    }

    let url = format!("{daemon_base_url}{}", request.path);
    let mut call = http_agent
        .request(&method, &url)
        .set("X-Aries-Token", daemon_token);
    if request.body.is_some() {
        call = call.set("Content-Type", "application/json");
    }
    let response = match request.body {
        Some(body) => call.send_string(&body),
        None => call.call(),
    };
    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(error)) => {
            return Err(format!("native daemon transport failed: {error}"));
        }
    };
    let status = response.status();
    let body = response
        .into_string()
        .map_err(|error| format!("native daemon response failed: {error}"))?;
    Ok(NativeDaemonResponse {
        status,
        content_length: body.len(),
        body,
        transport: "rust-http-fallback",
    })
}

#[tauri::command]
async fn native_daemon_request(
    state: tauri::State<'_, DaemonProcess>,
    request: NativeDaemonRequest,
) -> Result<NativeDaemonResponse, String> {
    let access_allowed = state.access_allowed.load(Ordering::SeqCst);
    if !access_allowed {
        return Err("aries daemon access is not licensed".to_string());
    }
    if !valid_native_daemon_path(&request.path) {
        return Err("native daemon path is outside the local API".to_string());
    }
    match state.native_transport.request(&request).await {
        Ok(response) => Ok(response),
        #[cfg(unix)]
        Err(NativeTransportError::Failed(error)) => Err(error),
        Err(NativeTransportError::Unavailable(error)) => {
            log::warn!("{error}; using local HTTP compatibility transport");
            let http_agent = state.http_agent.clone();
            let daemon_base_url = state.daemon_base_url.clone();
            let daemon_token = state.daemon_token.clone();
            tauri::async_runtime::spawn_blocking(move || {
                send_native_daemon_request(
                    &http_agent,
                    access_allowed,
                    &daemon_base_url,
                    &daemon_token,
                    request,
                )
            })
            .await
            .map_err(|task_error| format!("native daemon fallback task failed: {task_error}"))?
        }
    }
}

fn spawn_daemon(
    handle: &tauri::AppHandle,
    port: u16,
    daemon_token: &str,
    native_socket_path: Option<&Path>,
) -> std::io::Result<Child> {
    let mut command = if cfg!(debug_assertions) {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .canonicalize()?;
        let python = if cfg!(target_os = "windows") {
            repo_root.join("webapp/.venv/Scripts/python.exe")
        } else {
            repo_root.join("webapp/.venv/bin/python")
        };
        let mut command = Command::new(&python);
        command
            .args(["-m", "webapp.daemon"])
            .current_dir(&repo_root);
        let mut python_paths = vec![repo_root.join("SWEP").join("src")];
        if let Some(existing) = std::env::var_os("PYTHONPATH") {
            python_paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(python_path) = std::env::join_paths(python_paths) {
            command.env("PYTHONPATH", python_path);
        }
        apply_daemon_environment(
            &mut command,
            port,
            daemon_token,
            &repo_root,
            native_socket_path,
        );
        command
    } else {
        let resource_dir = bundled_resource_dir(handle)?;
        let daemon_binary = if cfg!(target_os = "windows") {
            "aries-daemon.exe"
        } else {
            "aries-daemon"
        };
        let resource_sidecar = resource_dir
            .join("binaries")
            .join("aries-daemon")
            .join(daemon_binary);
        if resource_sidecar.exists() {
            let mut command = Command::new(resource_sidecar);
            apply_daemon_environment(
                &mut command,
                port,
                daemon_token,
                &resource_dir,
                native_socket_path,
            );
            attach_daemon_logs(&mut command, handle);
            configure_daemon_process(&mut command);
            return command.spawn();
        }
        let adjacent_sidecar = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.join(daemon_binary)));
        if let Some(bin_path) = adjacent_sidecar.filter(|path| path.exists()) {
            let mut command = Command::new(bin_path);
            apply_daemon_environment(
                &mut command,
                port,
                daemon_token,
                &resource_dir,
                native_socket_path,
            );
            attach_daemon_logs(&mut command, handle);
            configure_daemon_process(&mut command);
            return command.spawn();
        }
        let bin_path = resource_dir.join("binaries").join(daemon_binary);
        let mut command = Command::new(bin_path);
        apply_daemon_environment(
            &mut command,
            port,
            daemon_token,
            &resource_dir,
            native_socket_path,
        );
        command
    };
    attach_daemon_logs(&mut command, handle);
    configure_daemon_process(&mut command);
    command.spawn()
}

fn terminate_daemon_child(state: &DaemonProcess, reason: &str) {
    let mut guard = match state.child.lock() {
        Ok(guard) => guard,
        Err(error) => {
            log::warn!("failed to lock daemon process during {reason}: {error}");
            return;
        }
    };
    let Some(mut daemon) = guard.take() else {
        return;
    };
    match daemon.try_wait() {
        Ok(Some(status)) => {
            log::info!("aries daemon already exited during {reason}: {status}");
            return;
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!("failed to inspect daemon before {reason}: {error}");
        }
    }
    let pid = daemon.id();
    if let Err(error) = daemon.kill() {
        log::warn!("failed to stop aries daemon pid {pid} during {reason}: {error}");
    }
    match daemon.wait() {
        Ok(status) => log::info!("stopped aries daemon pid {pid} during {reason}: {status}"),
        Err(error) => log::warn!("failed to reap aries daemon pid {pid} during {reason}: {error}"),
    }
}

fn stop_daemon(app: &AppHandle<Wry>, reason: &str) {
    let Some(state) = app.try_state::<DaemonProcess>() else {
        return;
    };
    state.stopping.store(true, Ordering::SeqCst);
    terminate_daemon_child(&state, reason);
}

fn start_daemon_if_permitted(app: &AppHandle<Wry>, reason: &str) -> Result<Option<u32>, String> {
    let Some(state) = app.try_state::<DaemonProcess>() else {
        return Err("aries daemon state is unavailable".to_string());
    };
    if state.stopping.load(Ordering::SeqCst) || !state.access_allowed.load(Ordering::SeqCst) {
        return Ok(None);
    }

    let _launch_guard = state
        .launch_lock
        .lock()
        .map_err(|error| error.to_string())?;
    if state.stopping.load(Ordering::SeqCst) || !state.access_allowed.load(Ordering::SeqCst) {
        return Ok(None);
    }

    let mut child_guard = state.child.lock().map_err(|error| error.to_string())?;
    if let Some(child) = child_guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return Ok(None),
            Ok(Some(status)) => {
                log::info!("aries daemon had exited before {reason}: {status}");
                let _ = child_guard.take();
            }
            Err(error) => {
                return Err(format!(
                    "failed to inspect aries daemon before {reason}: {error}"
                ));
            }
        }
    }

    state.native_transport.mark_daemon_starting();
    let mut daemon = spawn_daemon(
        app,
        state.port,
        &state.daemon_token,
        state.native_transport.socket_path(),
    )
    .map_err(|error| format!("failed to spawn aries daemon: {error}"))?;
    let pid = daemon.id();
    if state.stopping.load(Ordering::SeqCst) || !state.access_allowed.load(Ordering::SeqCst) {
        let _ = daemon.kill();
        let _ = daemon.wait();
        return Ok(None);
    }
    *child_guard = Some(daemon);
    drop(child_guard);

    log::info!("started aries daemon pid {pid} during {reason}");
    install_daemon_native_menu_when_ready(
        app.clone(),
        state.daemon_base_url.clone(),
        state.daemon_token.clone(),
        state.native_started_at,
    );
    Ok(Some(pid))
}

pub(crate) fn reconcile_daemon_license_gate(app: &AppHandle<Wry>) {
    let Some(state) = app.try_state::<DaemonProcess>() else {
        log::warn!("cannot reconcile daemon license gate before daemon state is ready");
        return;
    };
    let access_allowed = licensing::daemon_access_allowed(app);
    let was_allowed = state.access_allowed.swap(access_allowed, Ordering::SeqCst);
    if !access_allowed {
        if was_allowed {
            log::info!("license gate closed; stopping aries daemon");
        }
        terminate_daemon_child(&state, "license gate closed");
        return;
    }

    if !was_allowed {
        log::info!("license gate opened; starting aries daemon");
    }
    if let Err(error) = start_daemon_if_permitted(app, "license gate opened") {
        log::warn!("failed to start aries daemon after license reconciliation: {error}");
    }
}

fn start_daemon_supervisor(app: AppHandle<Wry>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let Some(state) = app.try_state::<DaemonProcess>() else {
            return;
        };
        if state.stopping.load(Ordering::SeqCst) {
            return;
        }
        if !state.access_allowed.load(Ordering::SeqCst) {
            continue;
        }

        let should_restart = {
            let mut guard = match state.child.lock() {
                Ok(guard) => guard,
                Err(error) => {
                    log::warn!("failed to lock daemon process during supervisor check: {error}");
                    return;
                }
            };
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        log::warn!("aries daemon exited unexpectedly: {status}; restarting");
                        let _ = guard.take();
                        true
                    }
                    Ok(None) => false,
                    Err(error) => {
                        log::warn!("failed to inspect aries daemon from supervisor: {error}");
                        false
                    }
                },
                None => true,
            }
        };
        if !should_restart
            || state.stopping.load(Ordering::SeqCst)
            || !state.access_allowed.load(Ordering::SeqCst)
        {
            continue;
        }

        match start_daemon_if_permitted(&app, "supervisor restart") {
            Ok(Some(pid)) => {
                log::info!("restarted aries daemon pid {pid}");
                let _ = app.emit("aries://daemon-restarted", ());
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("failed to restart aries daemon: {error}");
            }
        }
    });
}

fn wait_for_daemon_ready(daemon_base_url: &str, timeout: Duration) -> std::io::Result<()> {
    let started_at = Instant::now();
    let health_url = format!("{daemon_base_url}/health");
    while started_at.elapsed() < timeout {
        match ureq::get(&health_url)
            .timeout(Duration::from_secs(2))
            .call()
        {
            Ok(response) if (200..300).contains(&response.status()) => return Ok(()),
            _ => {}
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        format!("aries daemon did not become healthy at {health_url}"),
    ))
}

fn chart_picker_url(app: &tauri::AppHandle, path: &str) -> Result<Url, String> {
    let base = if cfg!(debug_assertions) {
        app.config()
            .build
            .dev_url
            .clone()
            .unwrap_or_else(|| Url::parse("tauri://localhost").expect("valid tauri app url"))
    } else {
        Url::parse("tauri://localhost").expect("valid tauri app url")
    };
    base.join(path).map_err(|e| e.to_string())
}

fn chart_picker_theme(theme: Option<&str>) -> tauri::Theme {
    if matches!(theme, Some("light")) {
        tauri::Theme::Light
    } else {
        tauri::Theme::Dark
    }
}

fn chart_picker_background(theme: tauri::Theme, background: Option<Vec<u8>>) -> Color {
    if let Some(rgb) = background.filter(|rgb| rgb.len() >= 3) {
        return Color(rgb[0], rgb[1], rgb[2], 255);
    }
    match theme {
        tauri::Theme::Light => Color(255, 255, 255, 255),
        tauri::Theme::Dark => Color(35, 36, 40, 255),
        _ => Color(35, 36, 40, 255),
    }
}

fn apply_native_window_theme(
    window: &WebviewWindow<Wry>,
    theme: Option<&str>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    let native_theme = chart_picker_theme(theme);
    window
        .set_theme(Some(native_theme))
        .map_err(|e| e.to_string())?;
    window
        .set_background_color(Some(chart_picker_background(native_theme, background)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// https://v2.tauri.app/learn/splashscreen/: frontend setup completes before show.
#[tauri::command]
fn show_main_window(
    window: WebviewWindow<Wry>,
    theme: Option<String>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("main window readiness must come from the main webview".into());
    }
    apply_native_window_theme(&window, theme.as_deref(), background)?;
    window.show().map_err(|error| error.to_string())?;
    #[cfg(debug_assertions)]
    log::info!("main-window-ready visible={}", window.is_visible().map_err(|e| e.to_string())?);
    Ok(())
}

fn build_chart_picker_window(
    app: &tauri::AppHandle,
    path: &str,
    title: &str,
    theme: Option<&str>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    let native_theme = chart_picker_theme(theme);
    let builder = WebviewWindowBuilder::new(app, CHART_PICKER_WINDOW, WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(CHART_PICKER_INITIAL_WIDTH, 660.0)
        .min_inner_size(CHART_PICKER_MIN_WIDTH, 480.0)
        .resizable(true)
        .decorations(false)
        .shadow(true)
        .skip_taskbar(true)
        .theme(Some(native_theme))
        .background_color(chart_picker_background(native_theme, background))
        .center()
        .focused(false)
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

fn show_chart_picker_window(window: WebviewWindow<Wry>) -> Result<(), String> {
    let scheduled_window = window.clone();
    window
        .run_on_main_thread(move || {
            if let Err(error) = prepare_and_show_tool_window(&scheduled_window) {
                log::error!("failed to show chart picker: {error}");
            }
        })
        .map_err(|e| e.to_string())
}

fn emit_chart_picker_window_perf(
    app: &tauri::AppHandle,
    phase: &str,
    started_at: Instant,
    navigated: bool,
    created: bool,
    visible: bool,
) {
    let _ = app.emit(
        "aries://chart-picker-window",
        ChartPickerWindowPerf {
            phase: phase.to_string(),
            ms: started_at.elapsed().as_secs_f64() * 1000.0,
            navigated,
            created,
            visible,
        },
    );
}

fn open_chart_picker_window_impl(
    app: &tauri::AppHandle,
    path: &str,
    title: &str,
    theme: Option<&str>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    if !path.starts_with("/chart-picker") {
        return Err("invalid chart picker path".to_string());
    }
    let started_at = Instant::now();
    if let Some(window) = app.get_webview_window(CHART_PICKER_WINDOW) {
        window.set_title(title).map_err(|e| e.to_string())?;
        apply_native_window_theme(&window, theme, background)?;
        let target_url = chart_picker_url(app, path)?;
        let current_url = window.url().map_err(|e| e.to_string())?;
        let mut navigated = false;
        if current_url != target_url {
            window.navigate(target_url).map_err(|e| e.to_string())?;
            navigated = true;
        }
        show_chart_picker_window(window)?;
        emit_chart_picker_window_perf(app, "open", started_at, navigated, false, true);
        Ok(())
    } else {
        build_chart_picker_window(app, path, title, theme, background)?;
        show_chart_picker_window(
            app.get_webview_window(CHART_PICKER_WINDOW)
                .ok_or("missing chart picker window")?,
        )?;
        emit_chart_picker_window_perf(app, "open", started_at, false, true, true);
        Ok(())
    }
}

fn prewarm_chart_picker_window_impl(
    app: &tauri::AppHandle,
    path: &str,
    title: &str,
    theme: Option<&str>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    if !path.starts_with("/chart-picker") {
        return Err("invalid chart picker path".to_string());
    }
    let started_at = Instant::now();
    if let Some(window) = app.get_webview_window(CHART_PICKER_WINDOW) {
        apply_native_window_theme(&window, theme, background)?;
        emit_chart_picker_window_perf(app, "prewarm", started_at, false, false, false);
        return Ok(());
    }
    build_chart_picker_window(app, path, title, theme, background)?;
    emit_chart_picker_window_perf(app, "prewarm", started_at, false, true, false);
    Ok(())
}

// Parse the baked fallback manifest. Used only when the daemon fetch fails so
// the app is never menu-less. The const is valid JSON checked in alongside this
// source, so this should not fail; expect() documents the invariant.
fn baked_native_menu_manifest() -> NativeMenuManifest {
    serde_json::from_str(NATIVE_MENU_MANIFEST_JSON).expect("invalid baked native menu manifest")
}

fn collect_native_menu_command_ids(node: &NativeMenuNode, ids: &mut HashSet<String>) {
    if matches!(node.node_type.as_str(), "item" | "check") {
        if let Some(id) = node.id.as_deref() {
            ids.insert(id.to_string());
        }
    }
    for child in &node.children {
        collect_native_menu_command_ids(child, ids);
    }
}

fn native_menu_command_ids(manifest: &NativeMenuManifest) -> HashSet<String> {
    let mut ids = HashSet::new();
    for node in &manifest.menus {
        collect_native_menu_command_ids(node, &mut ids);
    }
    ids
}

// Fetch the LIVE native-menu tree from the daemon's workspace manifest.
// GET /api/workspace/manifest -> { nativeMenu: { menus: [...] }, ... }. The
// daemon is guaranteed listening here because setup() only calls this after
// wait_for_daemon_ready succeeds. A blocking ureq GET keeps this a single
// synchronous step inside setup() (no async runtime needed).
fn fetch_native_menu_manifest(
    daemon_base_url: &str,
    daemon_token: &str,
) -> Result<NativeMenuManifest, String> {
    let manifest_url = format!("{daemon_base_url}/api/workspace/manifest");
    let mut request = ureq::get(&manifest_url).timeout(Duration::from_secs(5));
    if !daemon_token.is_empty() {
        request = request.set("X-Aries-Token", daemon_token);
    }
    let body = request
        .call()
        .map_err(|e| format!("daemon manifest request failed: {e}"))?
        .into_string()
        .map_err(|e| format!("daemon manifest read failed: {e}"))?;
    let root: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("daemon manifest parse failed: {e}"))?;
    let native_menu = root
        .get("nativeMenu")
        .ok_or_else(|| "daemon manifest missing nativeMenu".to_string())?;
    serde_json::from_value(native_menu.clone())
        .map_err(|e| format!("daemon nativeMenu shape mismatch: {e}"))
}

// Build the native menu from a parsed manifest value (runtime daemon data, or
// the baked fallback). The app submenu (Hide/Quit predefined items) is always
// constructed locally; the file/daemon-sourced submenus are appended after it.
fn build_native_menu_from_manifest(
    handle: &AppHandle,
    manifest: &NativeMenuManifest,
) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let app_about = MenuItemBuilder::with_id(APP_ABOUT_MENU_ID, "About Aries")
        .enabled(true)
        .build(handle)?;
    let app_services = PredefinedMenuItem::services(handle, None)?;
    let app_hide = PredefinedMenuItem::hide(handle, None)?;
    let app_hide_others = PredefinedMenuItem::hide_others(handle, None)?;
    let app_show_all = PredefinedMenuItem::show_all(handle, None)?;
    let app_quit = PredefinedMenuItem::quit(handle, None)?;
    let app_menu = SubmenuBuilder::new(handle, "Aries")
        .item(&app_about)
        .separator()
        .item(&app_services)
        .separator()
        .item(&app_hide)
        .item(&app_hide_others)
        .item(&app_show_all)
        .separator()
        .item(&app_quit)
        .build()?;
    let edit_menu = Submenu::with_id_and_items(
        handle,
        "menu.edit",
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            // Keep Select All in Edit without reserving Cmd+A at the native
            // menu layer. The webview handles Cmd+A in editable fields and
            // routes it to Astrocartography elsewhere.
            &MenuItemBuilder::with_id("menu.edit.select-all", "Select All")
                .enabled(true)
                .build(handle)?,
        ],
    )?;
    let window_menu = Submenu::with_id_and_items(
        handle,
        "menu.window",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    let mut builder = MenuBuilder::new(handle).item(&app_menu);
    let mut edit_menu_inserted = false;
    let mut window_menu_inserted = false;
    for menu_node in &manifest.menus {
        if !edit_menu_inserted && menu_node.id.as_deref() != Some("menu.file") {
            builder = builder.item(&edit_menu);
            edit_menu_inserted = true;
        }
        if !window_menu_inserted && menu_node.id.as_deref() == Some("menu.help") {
            builder = builder.item(&window_menu);
            window_menu_inserted = true;
        }
        let submenu = build_manifest_submenu(handle, menu_node)?;
        builder = builder.item(&submenu);
        if !edit_menu_inserted && menu_node.id.as_deref() == Some("menu.file") {
            builder = builder.item(&edit_menu);
            edit_menu_inserted = true;
        }
    }
    if !edit_menu_inserted {
        builder = builder.item(&edit_menu);
    }
    if !window_menu_inserted {
        builder = builder.item(&window_menu);
    }
    builder.build()
}

// `.menu()` builder callback: runs at app-builder construction (BEFORE the
// daemon is spawned/ready), so it can only use the baked fallback. setup() then
// re-fetches the LIVE tree from the daemon and replaces this via app.set_menu.
fn build_native_menu(handle: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    build_native_menu_from_manifest(handle, &baked_native_menu_manifest())
}

// Fetches the live menu tree from the daemon and swaps it in; on any failure,
// leaves the baked fallback menu (already installed by the `.menu()` builder
// callback) in place so the app is never menu-less.
fn install_daemon_native_menu(app: &AppHandle, daemon_base_url: &str, daemon_token: &str) -> Result<(), String> {
    let manifest = fetch_native_menu_manifest(daemon_base_url, daemon_token)
        .map_err(|error| error.to_string())?;
    let menu = build_native_menu_from_manifest(app, &manifest).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    app.state::<NativeMenuCommandIds>().replace_from_manifest(&manifest)?;
    Ok(())
}

fn install_daemon_native_menu_when_ready(
    app: AppHandle,
    daemon_base_url: String,
    daemon_token: String,
    native_started_at: Instant,
) {
    app.state::<NativeMenuReadiness>().begin();
    thread::spawn(move || {
        if let Err(error) = wait_for_daemon_ready(
            &daemon_base_url,
            Duration::from_secs(DAEMON_READY_TIMEOUT_SECS),
        ) {
            log::error!(
                "failed to start aries daemon within {DAEMON_READY_TIMEOUT_SECS}s: {error}"
            );
            app.state::<NativeMenuReadiness>().finish(Err(error.to_string()));
            return;
        }
        record_native_startup_perf(
            "daemon-health-ready-rust",
            native_started_at,
            serde_json::json!({ "daemonBaseUrl": &daemon_base_url }),
        );
        let result = install_daemon_native_menu(&app, &daemon_base_url, &daemon_token);
        if let Err(error) = &result {
            log::warn!("failed to install daemon native menu, keeping baked fallback: {error}");
        }
        app.state::<NativeMenuReadiness>().finish(result);
        record_native_startup_perf(
            "daemon-menu-installed-rust",
            native_started_at,
            serde_json::json!({ "daemonBaseUrl": &daemon_base_url }),
        );
        let _ = app.emit("aries://daemon-ready", ());
    });
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn install_compact_macos_traffic_lights(window: &WebviewWindow<Wry>) -> Result<(), String> {
    use objc2::ClassType;
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("main NSWindow pointer is null".to_string());
    }

    // Intel Aries must remain dependable across the older AppKit versions it
    // supports. Keep Apple's own controls attached to their native titlebar
    // host instead of moving cloned utility buttons through private view
    // hierarchies whose coordinates differ between macOS releases.
    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.as_super().as_super().setHidden(false);
            }
        }
    }
    Ok(())
}

#[cfg(all(target_os = "macos", not(target_arch = "x86_64")))]
fn install_compact_macos_traffic_lights(window: &WebviewWindow<Wry>) -> Result<(), String> {
    use objc2::ClassType;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSControlSize, NSWindow, NSWindowButton, NSWindowStyleMask};

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("main NSWindow pointer is null".to_string());
    }

    unsafe {
        let ns_window: &NSWindow = &*ns_window_ptr.cast();
        let close = ns_window
            .standardWindowButton(NSWindowButton::CloseButton)
            .ok_or_else(|| "close button unavailable".to_string())?;
        let miniaturize = ns_window
            .standardWindowButton(NSWindowButton::MiniaturizeButton)
            .ok_or_else(|| "minimize button unavailable".to_string())?;
        let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

        let mut buttons = vec![close, miniaturize];
        if let Some(zoom) = zoom {
            buttons.push(zoom);
        }

        let regular_close_rect = buttons[0].frame();
        let regular_miniaturize_rect = buttons[1].frame();
        let regular_close_center_x =
            regular_close_rect.origin.x + (regular_close_rect.size.width / 2.0);
        let regular_miniaturize_center_x =
            regular_miniaturize_rect.origin.x + (regular_miniaturize_rect.size.width / 2.0);
        let measured_center_gap = regular_miniaturize_center_x - regular_close_center_x;
        let center_gap = if measured_center_gap.is_finite()
            && measured_center_gap > MAIN_TRAFFIC_LIGHT_DIAMETER
        {
            measured_center_gap
        } else {
            MAIN_TRAFFIC_LIGHT_CENTER_GAP
        };
        let center_y = regular_close_rect.origin.y + (regular_close_rect.size.height / 2.0);
        let Some(close_superview) = buttons[0].superview() else {
            return Ok(());
        };
        let traffic_light_host = close_superview;
        let cleanup_parent = traffic_light_host.superview();

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "traffic-light install must run on the main thread".to_string())?;
        let compact_style_mask = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable
            | NSWindowStyleMask::UtilityWindow;
        let button_kinds = [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ];

        // Build every replacement before touching the live titlebar. If AppKit
        // cannot provide compact controls, the original controls stay visible.
        let mut compact_buttons = Vec::with_capacity(buttons.len());
        for (index, button) in buttons.iter().enumerate() {
            let tag = COMPACT_TRAFFIC_LIGHT_TAG_BASE + index as isize;
            let compact_button = NSWindow::standardWindowButton_forStyleMask(
                button_kinds[index],
                compact_style_mask,
                mtm,
            )
            .ok_or_else(|| "compact standard window button unavailable".to_string())?;

            compact_button.setTag(tag);
            compact_button.setControlSize(NSControlSize::Small);
            if let Some(cell) = compact_button.cell() {
                cell.setControlSize(NSControlSize::Small);
                compact_button.updateCell(&cell);
            }
            if let Some(target) = button.target() {
                compact_button.setTarget(Some(&target));
            }
            compact_button.setAction(button.action());
            compact_button.sizeToFit();

            let compact_rect = compact_button.as_super().as_super().frame();
            let mut origin = compact_rect.origin;
            origin.x = MAIN_TRAFFIC_LIGHT_X + (index as f64 * center_gap);
            origin.y = center_y - (compact_rect.size.height / 2.0);
            compact_button.as_super().as_super().setFrameOrigin(origin);
            compact_buttons.push(compact_button);
        }

        for (index, compact_button) in compact_buttons.iter().enumerate() {
            let tag = COMPACT_TRAFFIC_LIGHT_TAG_BASE + index as isize;
            while let Some(existing_compact_button) = traffic_light_host.viewWithTag(tag) {
                existing_compact_button.removeFromSuperview();
            }
            if let Some(parent) = cleanup_parent.as_ref() {
                while let Some(existing_compact_button) = parent.viewWithTag(tag) {
                    existing_compact_button.removeFromSuperview();
                }
            }
            traffic_light_host.addSubview(compact_button.as_super().as_super());
        }

        let replacements_attached = compact_buttons
            .iter()
            .all(|button| button.as_super().as_super().superview().is_some());
        if !replacements_attached {
            for compact_button in &compact_buttons {
                compact_button.as_super().as_super().removeFromSuperview();
            }
            for button in &buttons {
                button.as_super().as_super().setHidden(false);
            }
            return Err("compact standard window buttons did not attach".to_string());
        }
        for button in &buttons {
            button.as_super().as_super().setHidden(true);
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn schedule_compact_macos_traffic_lights(window: WebviewWindow<Wry>, context: &'static str) {
    let scheduled_window = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        if let Err(error) = install_compact_macos_traffic_lights(&scheduled_window) {
            log::warn!("failed to compact macOS traffic lights {context}: {error}");
        }
    }) {
        log::warn!("failed to schedule macOS traffic-light compaction {context}: {error}");
    }
}

#[cfg(target_os = "macos")]
fn sampled_macos_color_hex(color: *mut objc2_app_kit::NSColor) -> Option<String> {
    use objc2_app_kit::NSColorSpace;

    // SAFETY: AppKit supplies this pointer to the selection handler and keeps
    // the NSColor alive for the duration of the callback. A null pointer means
    // the user cancelled the sampler.
    let color = unsafe { color.as_ref() }?;
    let color = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    let component = |value: f64| -> u8 { (value.clamp(0.0, 1.0) * 255.0).round() as u8 };
    Some(format!(
        "#{:02X}{:02X}{:02X}",
        component(color.redComponent()),
        component(color.greenComponent()),
        component(color.blueComponent()),
    ))
}

#[tauri::command]
async fn sample_screen_color(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2_app_kit::{NSColor, NSColorSampler};
        use std::sync::Arc;
        use tokio::sync::oneshot;

        let (sender, receiver) = oneshot::channel();
        app.run_on_main_thread(move || {
            let sender = Arc::new(Mutex::new(Some(sender)));
            let selection_sender = Arc::clone(&sender);
            let selection_handler = RcBlock::new(move |color: *mut NSColor| {
                let sampled = sampled_macos_color_hex(color);
                let mut sender = selection_sender
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some(sender) = sender.take() {
                    let _ = sender.send(sampled);
                }
            });
            let sampler = NSColorSampler::new();
            // SAFETY: NSColorSampler requires this call on the main thread;
            // run_on_main_thread provides that guarantee. AppKit retains the
            // sampler and selection block until selection or cancellation.
            unsafe {
                sampler.showSamplerWithSelectionHandler(&selection_handler);
            }
        })
        .map_err(|error| format!("failed to start the macOS color sampler: {error}"))?;

        return receiver
            .await
            .map_err(|error| format!("macOS color sampler did not finish: {error}"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("native screen color sampling is unavailable on this platform".to_string())
    }
}

fn build_manifest_submenu(
    handle: &AppHandle,
    node: &NativeMenuNode,
) -> tauri::Result<Submenu<Wry>> {
    let id = node.id.as_deref().unwrap_or("menu.unknown");
    let label = node.label.as_deref().unwrap_or("");
    let mut builder =
        SubmenuBuilder::with_id(handle, id, label).enabled(node.enabled.unwrap_or(true));

    for child in &node.children {
        if child.id.as_deref() == Some(ARIES_ABOUT_COMMAND_ID) {
            continue;
        }
        match child.node_type.as_str() {
            "separator" => {
                builder = builder.separator();
            }
            "submenu" => {
                let submenu = build_manifest_submenu(handle, child)?;
                builder = builder.item(&submenu);
            }
            "check" => {
                let id = child.id.as_deref().unwrap_or("menu.check.unknown");
                let label = child.label.as_deref().unwrap_or("");
                let mut item = CheckMenuItemBuilder::with_id(id, label)
                    .enabled(child.enabled.unwrap_or(false))
                    .checked(child.checked.unwrap_or(false));
                if let Some(accelerator) = child.accelerator.as_deref() {
                    item = item.accelerator(accelerator);
                }
                let item = item.build(handle)?;
                builder = builder.item(&item);
            }
            _ => {
                let id = child.id.as_deref().unwrap_or("menu.item.unknown");
                let label = child.label.as_deref().unwrap_or("");
                let mut item =
                    MenuItemBuilder::with_id(id, label).enabled(child.enabled.unwrap_or(false));
                if let Some(accelerator) = child.accelerator.as_deref() {
                    item = item.accelerator(accelerator);
                }
                let item = item.build(handle)?;
                builder = builder.item(&item);
            }
        }
    }

    builder.build()
}

fn set_menu_item_enabled(item: &MenuItemKind<Wry>, enabled: bool) -> tauri::Result<()> {
    match item {
        MenuItemKind::MenuItem(item) => item.set_enabled(enabled),
        MenuItemKind::Submenu(item) => item.set_enabled(enabled),
        MenuItemKind::Check(item) => item.set_enabled(enabled),
        MenuItemKind::Icon(item) => item.set_enabled(enabled),
        MenuItemKind::Predefined(_) => Ok(()),
    }
}

fn set_menu_enabled_in_items(
    items: Vec<MenuItemKind<Wry>>,
    id: &str,
    enabled: bool,
) -> tauri::Result<bool> {
    for item in items {
        if item.id().as_ref() == id {
            set_menu_item_enabled(&item, enabled)?;
            return Ok(true);
        }
        if let MenuItemKind::Submenu(submenu) = item {
            if set_menu_enabled_in_items(submenu.items()?, id, enabled)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// Relabel sync for language changes. The native menu is built once (localized to
// the saved language) when the daemon manifest is fetched at startup; a LIVE
// language change pushes fresh labels from React (set_native_menu_labels) so the
// bar re-localizes in place, preserving enablement / checked / recent state that
// a full menu rebuild would reset. Predefined items (Undo/Cut/Quit/…) are
// OS-localized and never appear in the pushed set.
fn set_menu_item_text(item: &MenuItemKind<Wry>, text: &str) -> tauri::Result<()> {
    match item {
        MenuItemKind::MenuItem(item) => item.set_text(text),
        MenuItemKind::Submenu(item) => item.set_text(text),
        MenuItemKind::Check(item) => item.set_text(text),
        MenuItemKind::Icon(item) => item.set_text(text),
        MenuItemKind::Predefined(_) => Ok(()),
    }
}

fn set_menu_text_in_items(
    items: Vec<MenuItemKind<Wry>>,
    id: &str,
    text: &str,
) -> tauri::Result<bool> {
    for item in items {
        if item.id().as_ref() == id {
            set_menu_item_text(&item, text)?;
            return Ok(true);
        }
        if let MenuItemKind::Submenu(submenu) = item {
            if set_menu_text_in_items(submenu.items()?, id, text)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// Checkmark sync for check-type menu items (Charts > Elections / Horary lens
// themes — the wx twin is _refresh_pack_lens_menu_checks, morin.py:18963-18977).
// Only CheckMenuItem carries a check state; other kinds are skipped.
fn set_menu_checked_in_items(
    items: Vec<MenuItemKind<Wry>>,
    id: &str,
    checked: bool,
) -> tauri::Result<bool> {
    for item in items {
        if item.id().as_ref() == id {
            if let MenuItemKind::Check(check) = &item {
                check.set_checked(checked)?;
            }
            return Ok(true);
        }
        if let MenuItemKind::Submenu(submenu) = item {
            if set_menu_checked_in_items(submenu.items()?, id, checked)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
async fn set_native_menu_checked(
    app: tauri::AppHandle,
    states: Vec<NativeMenuCheckedState>,
) -> Result<(), String> {
    app.state::<NativeMenuReadiness>().wait().await?;
    let menu = app
        .menu()
        .ok_or_else(|| "native menu is not installed".to_string())?;
    for state in states {
        set_menu_checked_in_items(
            menu.items().map_err(|e| e.to_string())?,
            &state.id,
            state.checked,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_chart_picker_window(
    app: tauri::AppHandle,
    path: String,
    title: String,
    theme: Option<String>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    open_chart_picker_window_impl(&app, &path, &title, theme.as_deref(), background)
}

#[tauri::command]
async fn prewarm_chart_picker_window(
    app: tauri::AppHandle,
    path: String,
    title: String,
    theme: Option<String>,
    background: Option<Vec<u8>>,
) -> Result<(), String> {
    prewarm_chart_picker_window_impl(&app, &path, &title, theme.as_deref(), background)
}

#[tauri::command]
async fn close_chart_picker_window(app: tauri::AppHandle) -> Result<(), String> {
    let started_at = Instant::now();
    if let Some(window) = app.get_webview_window(CHART_PICKER_WINDOW) {
        window.hide().map_err(|e| e.to_string())?;
        emit_chart_picker_window_perf(&app, "hide", started_at, false, false, false);
    }
    Ok(())
}

// Tauri's hidden-window/frontend-ready pattern:
// https://v2.tauri.app/learn/splashscreen/
// Retain the pending open too: webview creation can finish after the user cancels.
#[derive(Clone, Default, Serialize)]
struct ToolWindowIntent {
    generation: u64,
    open: bool,
    context: serde_json::Value,
}

impl ToolWindowIntent {
    fn can_reveal(&self, generation: u64) -> bool {
        self.open && self.generation == generation
    }
}

#[derive(Default)]
struct ToolWindowIntents(Mutex<std::collections::HashMap<String, ToolWindowIntent>>);

fn tool_window_intent(app: &tauri::AppHandle, label: &str) -> ToolWindowIntent {
    app.state::<ToolWindowIntents>().0.lock().unwrap()
        .get(label).cloned().unwrap_or_default()
}

fn set_tool_window_intent(app: &tauri::AppHandle, label: &str, open: bool, context: serde_json::Value) -> ToolWindowIntent {
    let state = app.state::<ToolWindowIntents>();
    let mut intents = state.0.lock().unwrap();
    let intent = intents.entry(label.to_string()).or_default();
    intent.generation += 1;
    intent.open = open;
    intent.context = context;
    intent.clone()
}

#[tauri::command]
fn get_tool_window_intent(app: tauri::AppHandle, window: WebviewWindow<Wry>) -> ToolWindowIntent {
    tool_window_intent(&app, window.label())
}

fn build_tool_window(
    app: &tauri::AppHandle,
    label: &str,
    path: &str,
    title: &str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("invalid tool window dimensions".into());
    }
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(path.into()))
        .title(title).inner_size(width, height)
        .min_inner_size(min_width.min(width), min_height.min(height))
        .decorations(false).shadow(true).resizable(true).skip_taskbar(true)
        .center().visible(false).focused(false);
    // Retained tools must receive open requests even after a long hidden spell.
    let builder = builder.background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
    #[cfg(target_os = "macos")]
    let builder = builder.decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let window = builder.build().map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    log::info!("tool-window-created label={label} visible={}", window.is_visible().map_err(|e| e.to_string())?);
    #[cfg(not(debug_assertions))]
    let _ = window;
    Ok(())
}

#[tauri::command]
async fn open_chart_editor_window(
    app: tauri::AppHandle, title: String, width: f64, height: f64, context: serde_json::Value,
    prewarm: Option<bool>,
) -> Result<(), String> {
    if prewarm.unwrap_or(false) {
        if app.get_webview_window(CHART_EDITOR_WINDOW).is_none() {
            build_tool_window(
                &app, CHART_EDITOR_WINDOW, "/chart-editor", &title, width, height,
                CHART_EDITOR_MIN_WIDTH, CHART_EDITOR_MIN_HEIGHT,
            )?;
        }
        return Ok(());
    }
    let intent = set_tool_window_intent(&app, CHART_EDITOR_WINDOW, true, context);
    if let Some(window) = app.get_webview_window(CHART_EDITOR_WINDOW) {
        window.set_title(&title).map_err(|e| e.to_string())?;
        return window.emit("aries://chart-editor-context", intent).map_err(|e| e.to_string());
    }
    build_tool_window(
        &app, CHART_EDITOR_WINDOW, "/chart-editor", &title, width, height,
        CHART_EDITOR_MIN_WIDTH, CHART_EDITOR_MIN_HEIGHT,
    )
}

fn show_ready_tool_window(app: &tauri::AppHandle, label: &'static str, generation: u64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        let scheduled_window = window.clone();
        let app = app.clone();
        window.run_on_main_thread(move || {
            let intent = tool_window_intent(&app, label);
            // A late load must never reveal a dismissed window or an older chart.
            if !intent.can_reveal(generation) { return; }
            if let Err(error) = prepare_and_show_tool_window(&scheduled_window) {
                log::error!("failed to show {label}: {error}");
            }
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_chart_editor_window(app: tauri::AppHandle, generation: u64) -> Result<(), String> {
    show_ready_tool_window(&app, CHART_EDITOR_WINDOW, generation)
}

fn hide_chart_editor_window_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let intent = set_tool_window_intent(app, CHART_EDITOR_WINDOW, false, serde_json::Value::Null);
    if let Some(window) = app.get_webview_window(CHART_EDITOR_WINDOW) {
        hide_tool_window(&window, intent.generation)?;
        window.emit("aries://chart-editor-hidden", intent).map_err(|e| e.to_string())?;
    }
    app.emit_to("main", "aries://chart-editor-closed", ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn hide_chart_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_chart_editor_window_impl(&app)
}

#[tauri::command]
async fn open_settings_window(
    app: tauri::AppHandle, tab: String, title: String, width: f64, height: f64, prewarm: Option<bool>,
) -> Result<(), String> {
    if tab.is_empty() || !tab.bytes().all(|c| c.is_ascii_lowercase()) {
        return Err("invalid settings window request".into());
    }
    if prewarm.unwrap_or(false) {
        if app.get_webview_window(SETTINGS_WINDOW).is_none() {
            build_tool_window(
                &app, SETTINGS_WINDOW, "/settings", &title, width, height, width, height,
            )?;
        }
        return Ok(());
    }
    let intent = set_tool_window_intent(&app, SETTINGS_WINDOW, true, serde_json::json!({"tab": tab}));
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        window.set_title(&title).map_err(|e| e.to_string())?;
        return window.emit("aries://settings-open", intent).map_err(|e| e.to_string());
    }
    build_tool_window(
        &app, SETTINGS_WINDOW, "/settings", &title, width, height, width, height,
    )
}

#[tauri::command]
async fn show_settings_window(app: tauri::AppHandle, generation: u64) -> Result<(), String> {
    show_ready_tool_window(&app, SETTINGS_WINDOW, generation)
}

fn prepare_and_show_tool_window(window: &WebviewWindow<Wry>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::ClassType;
        use objc2_app_kit::{NSWindow, NSWindowButton};

        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        if ptr.is_null() {
            return Err("tool NSWindow pointer is null".into());
        }
        // Called on the AppKit main thread. Tool windows use their own close
        // button and drag region, without a second native titlebar UI.
        unsafe {
            let native: &NSWindow = &*ptr.cast();
            for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
                if let Some(button) = native.standardWindowButton(kind) {
                    button.as_super().as_super().setHidden(true);
                }
            }
        }
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn hide_tool_window(window: &WebviewWindow<Wry>, generation: u64) -> Result<(), String> {
    let hidden = window.clone();
    window.run_on_main_thread(move || {
        let intent = tool_window_intent(hidden.app_handle(), hidden.label());
        if intent.generation != generation || intent.open { return; }
        if let Err(error) = hidden.hide() {
            log::error!("failed to hide {}: {error}", hidden.label());
        }
    }).map_err(|e| e.to_string())
}

fn hide_settings_window_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let intent = set_tool_window_intent(app, SETTINGS_WINDOW, false, serde_json::Value::Null);
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        hide_tool_window(&window, intent.generation)?;
        window.emit("aries://settings-open", intent)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_settings_window_impl(&app)
}

fn find_submenu_in_items(
    items: Vec<MenuItemKind<Wry>>,
    id: &str,
) -> tauri::Result<Option<Submenu<Wry>>> {
    for item in items {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.id().as_ref() == id {
                return Ok(Some(submenu));
            }
            if let Some(found) = find_submenu_in_items(submenu.items()?, id)? {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

fn update_recent_menu_command_ids(app: &AppHandle, ids: Vec<String>) -> Result<(), String> {
    if let Some(commands) = app.try_state::<NativeMenuCommandIds>() {
        commands.replace_recent_entries(ids)?;
    }
    Ok(())
}

fn should_emit_native_menu_command(app: &AppHandle, id: &str) -> bool {
    let Some(commands) = app.try_state::<NativeMenuCommandIds>() else {
        return false;
    };
    match commands.contains(id) {
        Ok(known) => known,
        Err(error) => {
            log::warn!("failed to read native menu command ids: {error}");
            false
        }
    }
}

fn native_menu_command_for_event<'a>(app: &AppHandle, id: &'a str) -> Option<&'a str> {
    if id == "menu.edit.select-all" {
        return Some(id);
    }
    if id == APP_ABOUT_MENU_ID {
        return Some(ARIES_ABOUT_COMMAND_ID);
    }
    should_emit_native_menu_command(app, id).then_some(id)
}

fn is_quit_confirmed(app: &AppHandle) -> bool {
    app.try_state::<QuitConfirmed>()
        .map(|state| state.0.lock().map(|confirmed| *confirmed).unwrap_or(true))
        .unwrap_or(true)
}

fn request_quit_preflight(app: &AppHandle) {
    let _ = app.emit("aries://quit-requested", ());
}

// File > Recent Charts is wx's dynamic submenu (morin.py:15716-15738): the
// daemon owns labels/order; this command only rebuilds the native submenu's
// items in place via the supported Submenu::remove_at/append runtime-mutation
// API (tauri::menu::Submenu, docs.rs/tauri/2). Empty list renders the disabled
// "(No recent charts)" row like wx (morin.py:15730-15732).
#[tauri::command]
async fn set_recent_charts(
    app: tauri::AppHandle,
    entries: Vec<RecentChartMenuEntry>,
) -> Result<(), String> {
    app.state::<NativeMenuReadiness>().wait().await?;
    let recent_command_ids: Vec<String> = entries.iter().map(|entry| entry.id.clone()).collect();
    let menu = app
        .menu()
        .ok_or_else(|| "native menu is not installed".to_string())?;
    let submenu = find_submenu_in_items(
        menu.items().map_err(|e| e.to_string())?,
        RECENT_CHARTS_SUBMENU_ID,
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "recent charts submenu not found".to_string())?;
    while submenu.remove_at(0).map_err(|e| e.to_string())?.is_some() {}
    if entries.is_empty() {
        let placeholder =
            MenuItemBuilder::with_id("menu.recent-charts.empty", "(No recent charts)")
                .enabled(false)
                .build(&app)
                .map_err(|e| e.to_string())?;
        submenu.append(&placeholder).map_err(|e| e.to_string())?;
        update_recent_menu_command_ids(&app, recent_command_ids)?;
        return Ok(());
    }
    for entry in entries {
        let item = MenuItemBuilder::with_id(entry.id, entry.label)
            .enabled(true)
            .build(&app)
            .map_err(|e| e.to_string())?;
        submenu.append(&item).map_err(|e| e.to_string())?;
    }
    update_recent_menu_command_ids(&app, recent_command_ids)?;
    Ok(())
}

// Update only explicitly saved designs. Keep factory choices, house-line
// routing, unrelated menu state, and the retained Settings window intact.
#[tauri::command]
async fn set_wheel_styles(
    app: tauri::AppHandle,
    entries: Vec<WheelStyleMenuEntry>,
) -> Result<(), String> {
    app.state::<NativeMenuReadiness>().wait().await?;
    let ids = wheel_style_command_ids(&entries)?;
    let menu = app.menu().ok_or_else(|| "native menu is not installed".to_string())?;
    let submenu = find_submenu_in_items(menu.items().map_err(|e| e.to_string())?,
        "menu.options.quick.wheel-layout").map_err(|e| e.to_string())?
        .ok_or_else(|| "wheel layout submenu not found".to_string())?;
    let current = submenu.items().map_err(|e| e.to_string())?;
    let saved: Vec<_> = current.iter().filter_map(|item| match item {
        MenuItemKind::Check(item) if item.id().as_ref().starts_with("quick.options.wheel-preset:") => Some(item),
        _ => None,
    }).collect();
    let same_catalog = saved.len() == entries.len() && saved.iter().zip(&entries)
        .all(|(item, entry)| item.id().as_ref() == entry.id && item.text().ok().as_deref() == Some(entry.label.as_str()));
    if same_catalog {
        for (item, entry) in saved.iter().zip(&entries) {
            item.set_checked(entry.checked).map_err(|e| e.to_string())?;
        }
    } else {
        let items: Result<Vec<_>, _> = entries.iter().map(|entry|
            CheckMenuItemBuilder::with_id(&entry.id, &entry.label).checked(entry.checked).build(&app)).collect();
        let items = items.map_err(|e| e.to_string())?;
        for (index, item) in current.iter().enumerate().rev() {
            if item.id().as_ref().starts_with("quick.options.wheel-preset:") {
                submenu.remove_at(index).map_err(|e| e.to_string())?;
            }
        }
        let retained = submenu.items().map_err(|e| e.to_string())?;
        let position = retained.iter().position(|item| !item.id().as_ref().starts_with("quick.options.layout:"))
            .unwrap_or(retained.len());
        for (offset, item) in items.iter().enumerate() {
            submenu.insert(item, position + offset).map_err(|e| e.to_string())?;
        }
    }
    if let Some(commands) = app.try_state::<NativeMenuCommandIds>() {
        commands.replace_wheel_styles(ids)?;
    }
    Ok(())
}

fn wheel_style_command_ids(entries: &[WheelStyleMenuEntry]) -> Result<Vec<String>, String> {
    let mut ids = HashSet::new();
    for entry in entries {
        if !entry.id.starts_with("quick.options.wheel-preset:user.") || entry.label.trim().is_empty()
            || !ids.insert(entry.id.clone()) {
            return Err("invalid saved wheel style menu entry".into());
        }
    }
    Ok(entries.iter().map(|entry| entry.id.clone()).collect())
}

// App-quit confirm door. The React shell calls this after quit-preflight + the
// Save/Discard/Cancel modal resolve "clear to quit" (Save written, notes flushed,
// or Discard chosen). It marks the quit confirmed and re-issues the main-window
// close so the CloseRequested handler tears the daemon down for real. Cancel in
// the modal simply never calls this, leaving the window open (wx onClose early
// return, morin.py:15616-15617).
#[tauri::command]
async fn confirm_quit(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<QuitConfirmed>() {
        *state.0.lock().map_err(|e| e.to_string())? = true;
    }
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_native_menu_enabled(
    app: tauri::AppHandle,
    states: Vec<NativeMenuEnabledState>,
) -> Result<(), String> {
    app.state::<NativeMenuReadiness>().wait().await?;
    let menu = app
        .menu()
        .ok_or_else(|| "native menu is not installed".to_string())?;
    for state in states {
        set_menu_enabled_in_items(
            menu.items().map_err(|e| e.to_string())?,
            &state.id,
            state.enabled,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_native_menu_labels(
    app: tauri::AppHandle,
    labels: Vec<NativeMenuLabelState>,
) -> Result<(), String> {
    app.state::<NativeMenuReadiness>().wait().await?;
    let menu = app
        .menu()
        .ok_or_else(|| "native menu is not installed".to_string())?;
    for state in labels {
        set_menu_text_in_items(
            menu.items().map_err(|e| e.to_string())?,
            &state.id,
            &state.label,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn record_frontend_perf(event: FrontendPerfEvent) -> Result<(), String> {
    let automatic_speedlog = speedlog_enabled() && event.name == "speedlog-summary";
    if frontend_perf_enabled() || automatic_speedlog {
        let raw = serde_json::to_string(&event).map_err(|e| e.to_string())?;
        log::info!("frontend-perf {raw}");
    }
    if automatic_speedlog {
        append_speedlog(&event)?;
    }
    Ok(())
}

pub fn verify_licensed_build_contract() -> Result<(), String> {
    licensing::validate_compiled_license_contract()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_macos_scrollbar_policy();

    let native_started_at = Instant::now();
    let daemon_port = match choose_daemon_port() {
        Ok(port) => port,
        Err(error) => {
            eprintln!("failed to choose aries daemon port: {error}");
            return;
        }
    };
    let daemon_base_url = format!("http://127.0.0.1:{daemon_port}");
    let daemon_token = generate_daemon_token();
    let native_perf = if frontend_perf_enabled() {
        "true"
    } else {
        "false"
    };
    let speedlog = if speedlog_enabled() { "true" } else { "false" };
    let native_platform = std::env::consts::OS;
    #[cfg(target_os = "windows")]
    let windows_caption_inset = windows_titlebar::caption_controls_inset_css_px();
    #[cfg(not(target_os = "windows"))]
    let windows_caption_inset = 0;
    let runtime_init_script = format!(
    "Object.defineProperty(window,\"__ARIES_TAURI_RUNTIME__\",{{value:true,configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_NATIVE_PLATFORM__\",{{value:\"{native_platform}\",configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_WINDOWS_CAPTION_INSET__\",{{value:{windows_caption_inset},configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_DAEMON_URL__\",{{value:\"{daemon_base_url}\",configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_DAEMON_TOKEN__\",{{value:\"{daemon_token}\",configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_NATIVE_PERF__\",{{value:{native_perf},configurable:false,writable:false}});Object.defineProperty(window,\"__ARIES_SPEEDLOG__\",{{value:{speedlog},configurable:false,writable:false}});"
  );
    let init_script = format!("{runtime_init_script}{DESKTOP_WEBVIEW_GUARD_SCRIPT}");

    tauri::Builder::default()
        .on_page_load(|_webview, _payload| {
            #[cfg(target_os = "macos")]
            if let Err(error) = _webview.with_webview(|platform| {
                // Wry enables tabFocusesLinks unconditionally. Restore WebKit's
                // normal macOS tab navigation in every app webview; do not mask
                // focused controls with CSS or intercept keyboard events.
                // https://developer.apple.com/documentation/webkit/wkpreferences/tabfocuseslinks
                // SAFETY: Tauri supplies a live WKWebView on its main thread.
                unsafe {
                    let webview = &*platform.inner().cast::<objc2_web_kit::WKWebView>();
                    webview.configuration().preferences().setTabFocusesLinks(false);
                }
            }) {
                log::warn!("failed to configure native tab navigation: {error}");
            }
        })
        .manage(NativeMenuReadiness::default())
        .manage(ToolWindowIntents::default())
        .append_invoke_initialization_script(init_script)
        .menu(build_native_menu)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            prewarm_chart_picker_window,
            open_chart_picker_window,
            close_chart_picker_window,
            get_tool_window_intent,
            open_chart_editor_window,
            show_chart_editor_window,
            hide_chart_editor_window,
            open_settings_window,
            show_settings_window,
            hide_settings_window,
            set_native_menu_enabled,
            set_native_menu_checked,
            set_native_menu_labels,
            set_recent_charts,
            set_wheel_styles,
            confirm_quit,
            record_frontend_perf,
            read_legal_document,
            native_daemon_request,
            sample_screen_color,
            licensing::license_status,
            licensing::license_activate,
            licensing::license_refresh,
            licensing::license_deactivate,
            licensing::license_list_devices,
            licensing::license_revoke_device,
            licensing::license_check_update,
            licensing::license_install_update,
        ])
        .setup(move |app| {
            let handle = app.handle();
            let daemon_access_allowed = licensing::daemon_access_allowed(handle);
            app.manage(DaemonProcess::new(
                daemon_port,
                daemon_base_url.clone(),
                daemon_token.clone(),
                native_started_at,
                daemon_access_allowed,
            ));
            app.manage(licensing::PendingLicenseUpdate::default());
            app.manage(QuitConfirmed(Mutex::new(false)));
            app.manage(NativeMenuCommandIds::from_manifest(
                &baked_native_menu_manifest(),
            ));

            let native_log_level = if cfg!(debug_assertions) || frontend_perf_enabled() {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            handle.plugin(
                tauri_plugin_log::Builder::default()
                    .level(native_log_level)
                    .build(),
            )?;
            record_native_startup_perf(
                "native-setup-start",
                native_started_at,
                serde_json::json!({ "daemonPort": daemon_port }),
            );
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = migrate_legacy_main_window_state(app.handle()) {
                    log::warn!("failed to migrate legacy main window frame: {error}");
                }
                if let Err(error) = restore_main_window_frame(&window) {
                    log::warn!("failed to restore main window frame: {error}");
                }
            }
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                match window.hwnd() {
                    Ok(hwnd) => {
                        if let Err(error) = windows_titlebar::install(hwnd) {
                            log::warn!(
                                "failed to install native Windows titlebar overlay: {error}"
                            );
                        }
                    }
                    Err(error) => log::warn!("failed to acquire main Windows HWND: {error}"),
                }
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = install_compact_macos_traffic_lights(&window) {
                    log::warn!("failed to compact macOS traffic lights: {error}");
                }
                schedule_compact_macos_traffic_lights(window, "after setup");
            }
            if daemon_access_allowed {
                record_native_startup_perf(
                    "daemon-spawn-start",
                    native_started_at,
                    serde_json::json!({ "daemonPort": daemon_port }),
                );
                if let Some(daemon_pid) = start_daemon_if_permitted(app.handle(), "startup")? {
                    record_native_startup_perf(
                        "daemon-spawned",
                        native_started_at,
                        serde_json::json!({ "daemonPort": daemon_port, "pid": daemon_pid }),
                    );
                }
            } else {
                log::info!("license gate closed at startup; aries daemon will wait for activation");
            }
            // The one-file PyInstaller daemon can take tens of seconds to extract and
            // import on first launch. Keep the native window responsive immediately;
            // the React shell retries daemon fetches, and the baked menu is replaced
            // with the live daemon menu as soon as the daemon is listening.
            start_daemon_supervisor(handle.clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(command_id) = native_menu_command_for_event(app, id) {
                if command_id == "menu.edit.select-all" {
                    // Native menus do not forward this click as a key event.
                    // Apply Select All in the focused webview, including a
                    // same-origin map iframe when it owns keyboard focus.
                    for label in ["main", SETTINGS_WINDOW, CHART_EDITOR_WINDOW] {
                        if let Some(window) = app.get_webview_window(label) {
                            if window.is_focused().unwrap_or(false) {
                                let _ = window.eval("(document.activeElement instanceof HTMLIFrameElement ? document.activeElement.contentDocument : document)?.execCommand('selectAll')");
                                break;
                            }
                        }
                    }
                    return;
                }
                if command_id == "workspace.close-active"
                    && app.get_webview_window(CHART_EDITOR_WINDOW)
                        .is_some_and(|window| window.is_focused().unwrap_or(false))
                {
                    let _ = hide_chart_editor_window_impl(app);
                    return;
                }
                if command_id == "workspace.close-active"
                    && app.get_webview_window(SETTINGS_WINDOW)
                        .is_some_and(|window| window.is_focused().unwrap_or(false))
                {
                    let _ = hide_settings_window_impl(app);
                    return;
                }
                let _ = app.emit("aries://menu-command", command_id);
            }
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Focused(true)
                        | tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
            {
                if let Some(main_window) = window.app_handle().get_webview_window("main") {
                    if let Err(error) = install_compact_macos_traffic_lights(&main_window) {
                        log::warn!(
                            "failed to compact macOS traffic lights after window relayout: {error}"
                        );
                    }
                    schedule_compact_macos_traffic_lights(main_window, "after window relayout");
                }
            }
            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                    if window.label() == "main" =>
                {
                    if let Err(error) = save_main_window_frame(window) {
                        log::warn!("failed to save main window frame: {error}");
                    }
                    return;
                }
                tauri::WindowEvent::CloseRequested { api, .. }
                    if window.label() == CHART_EDITOR_WINDOW =>
                {
                    api.prevent_close();
                    let _ = hide_chart_editor_window_impl(window.app_handle());
                    return;
                }
                tauri::WindowEvent::CloseRequested { api, .. }
                    if window.label() == SETTINGS_WINDOW =>
                {
                    api.prevent_close();
                    let _ = hide_settings_window_impl(window.app_handle());
                    return;
                }
                tauri::WindowEvent::CloseRequested { api, .. }
                    if window.label() == CHART_PICKER_WINDOW =>
                {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    // App-quit guard (wx onClose dirty-check, morin.py:15615-15617). Hold
                    // the close on the FIRST request so the React shell can run
                    // quit-preflight + the Save/Discard/Cancel modal; only once the shell
                    // calls confirm_quit (which flips QuitConfirmed and re-issues close)
                    // do we fall through to daemon teardown below.
                    if !is_quit_confirmed(window.app_handle()) {
                        api.prevent_close();
                        request_quit_preflight(window.app_handle());
                        return;
                    }
                    if let Err(error) = save_main_window_frame(window) {
                        log::warn!("failed to save main window frame: {error}");
                    }
                }
                _ => return,
            }
            let app = window.app_handle();
            stop_daemon(&app, "main window close");
            // Confirmed main-window close means quit the application. Retained
            // tools (including hidden prewarmed windows) must not keep the
            // event loop alive. Tauri owns teardown of every remaining window.
            app.exit(0);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. }
                if code.is_none() && !is_quit_confirmed(app) =>
            {
                api.prevent_exit();
                request_quit_preflight(app);
            }
            tauri::RunEvent::Exit => {
                stop_daemon(app, "tauri run exit");
            }
            _ => {}
        });
}


#[cfg(test)]
mod wheel_style_menu_tests {
    use super::*;

    #[test]
    fn saved_styles_reject_private_entries_and_preserve_other_commands() {
        let entry = |id: &str| WheelStyleMenuEntry {id: id.into(), label: "Saved style".into(), checked: false};
        assert!(wheel_style_command_ids(&[entry("quick.options.wheel-preset:working.anglo")]).is_err());
        assert!(wheel_style_command_ids(&[entry("quick.options.wheel-preset:migrated.old.anglo")]).is_err());
        let user = "quick.options.wheel-preset:user.saved";
        assert!(wheel_style_command_ids(&[entry(user), entry(user)]).is_err());
        let commands = NativeMenuCommandIds(Mutex::new(HashSet::from([
            "quick.options.layout:2".into(), "quick.options.anglo-dense-label-layout:routed-cusps".into(),
            "quick.options.wheel-preset:user.old".into(),
        ])));
        commands.replace_wheel_styles(wheel_style_command_ids(&[entry(user)]).unwrap()).unwrap();
        assert!(commands.contains(user).unwrap());
        assert!(!commands.contains("quick.options.wheel-preset:user.old").unwrap());
        assert!(commands.contains("quick.options.layout:2").unwrap());
        assert!(commands.contains("quick.options.anglo-dense-label-layout:routed-cusps").unwrap());
    }
}

#[cfg(test)]
mod tool_window_lifecycle_tests {
    use super::*;

    #[test]
    fn late_readiness_does_not_reopen_closed_or_retargeted_windows() {
        let mut intent = ToolWindowIntent::default();
        for generation in 1..=20 {
            intent.generation = generation;
            intent.open = true;
            assert!(intent.can_reveal(generation));
            assert!(!intent.can_reveal(generation - 1));
            intent.open = false;
            assert!(!intent.can_reveal(generation));
        }
    }
}
