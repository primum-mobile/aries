// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, Url, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

const PRODUCTION_CREDENTIAL_SERVICE: &str = "sh.aries.desktop.licensing";
const DEVELOPMENT_CREDENTIAL_SERVICE: &str = "sh.aries.desktop.licensing.dev";
const CREDENTIAL_USER: &str = "activation";
const PRODUCTION_LOCAL_STATE_FILE: &str = "license-state.json";
const DEVELOPMENT_LOCAL_STATE_FILE: &str = "license-state.dev.json";
const DEFAULT_LICENSE_SERVER_URL: &str = "";
const DEFAULT_LICENSE_PUBLIC_KEY: &str = "";
const UPDATE_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const UPDATE_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalState {
    device_id: String,
    activation_id: Option<String>,
    lease_token: Option<String>,
    lease_expires_at: Option<String>,
    refresh_after: Option<String>,
    provider: Option<String>,
    seats: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialSecret {
    license_key: String,
    activation_token: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct ActivationRequest {
    license_key: String,
    device_id: String,
    platform: String,
    arch: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct DeactivationRequest {
    device_id: String,
}

#[derive(Debug, Serialize)]
struct DeviceListRequest {
    license_key: String,
    device_id: String,
}

#[derive(Debug, Serialize)]
struct DeviceRevokeRequest {
    license_key: String,
    device_id: String,
    activation_id: String,
}

#[derive(Debug, Deserialize)]
struct ActivationResponse {
    activation_id: String,
    activation_token: String,
    lease_token: String,
    lease_expires_at: String,
    refresh_after: String,
    provider: String,
    seats: u32,
}

#[derive(Debug, Deserialize)]
struct LeasePayload {
    v: u8,
    activation_id: String,
    device: String,
    entitlements: Vec<String>,
    refresh_after: u64,
    exp: u64,
}

#[derive(Debug, Deserialize)]
struct LeaseHeader {
    alg: String,
    typ: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    configured: bool,
    required: bool,
    state: String,
    activation_id: Option<String>,
    provider: Option<String>,
    seats: Option<u32>,
    lease_expires_at: Option<String>,
    refresh_after: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct LicenseDevice {
    activation_id: String,
    platform: String,
    arch: String,
    activated_at: String,
    current: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct LicenseDevices {
    seats: u32,
    devices: Vec<LicenseDevice>,
    revoked_current: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub pub_date: Option<String>,
}

#[derive(Default)]
pub struct PendingLicenseUpdate(Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum UpdateInstallEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
        downloaded: usize,
    },
    Finished,
    Installed,
}

fn local_state_path(app: &AppHandle<Wry>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join(local_state_file()))
}

fn credential_service() -> &'static str {
    if cfg!(debug_assertions) {
        DEVELOPMENT_CREDENTIAL_SERVICE
    } else {
        PRODUCTION_CREDENTIAL_SERVICE
    }
}

fn local_state_file() -> &'static str {
    if cfg!(debug_assertions) {
        DEVELOPMENT_LOCAL_STATE_FILE
    } else {
        PRODUCTION_LOCAL_STATE_FILE
    }
}

fn read_local_state(app: &AppHandle<Wry>) -> Result<LocalState, String> {
    let path = local_state_path(app)?;
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(LocalState::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_local_state(app: &AppHandle<Wry>, state: &LocalState) -> Result<(), String> {
    let path = local_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    fs::write(&temporary, raw).map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn ensure_device_id(app: &AppHandle<Wry>) -> Result<LocalState, String> {
    let mut state = read_local_state(app)?;
    if state.device_id.is_empty() {
        state.device_id = random_device_id()?;
        write_local_state(app, &state)?;
    }
    Ok(state)
}

fn random_device_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| "device_id_generation_failed".to_string())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    ))
}

fn credential_entry() -> Result<Entry, String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("license_secure_storage_unsupported".to_string());
    }
    Entry::new(credential_service(), CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn store_credentials(secret: &CredentialSecret) -> Result<(), String> {
    let raw = serde_json::to_string(secret).map_err(|error| error.to_string())?;
    credential_entry()?
        .set_password(&raw)
        .map_err(|error| error.to_string())
}

fn read_credentials() -> Result<Option<CredentialSecret>, String> {
    match credential_entry()?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn clear_credentials() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn server_url() -> Result<&'static str, String> {
    let url = option_env!("ARIES_LICENSE_SERVER_URL")
        .unwrap_or(DEFAULT_LICENSE_SERVER_URL)
        .trim()
        .trim_end_matches('/');
    if url.is_empty() {
        return Err("license_server_unconfigured".to_string());
    }
    if !url.starts_with("https://")
        && !(cfg!(debug_assertions)
            && (url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")))
    {
        return Err("license_server_requires_https".to_string());
    }
    Ok(url)
}

fn license_required() -> bool {
    license_required_from_config(
        option_env!("ARIES_LICENSE_REQUIRED"),
        cfg!(debug_assertions),
        cfg!(target_os = "windows"),
    )
}

fn license_required_from_config(
    value: Option<&str>,
    debug_build: bool,
    windows_build: bool,
) -> bool {
    if windows_build && !debug_build {
        return true;
    }
    match value.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => true,
        "0" | "false" | "no" => false,
        // Release builds fail closed if a packaging path forgets to stamp the
        // commercial flag. Tauri/source development remains intentionally free.
        _ => !debug_build,
    }
}

pub(crate) fn validate_compiled_license_contract() -> Result<(), String> {
    if option_env!("ARIES_LICENSE_REQUIRED") != Some("1") {
        return Err("license_gate_not_compiled".to_string());
    }
    server_url()?;
    public_key()?;
    Ok(())
}

fn public_key() -> Result<VerifyingKey, String> {
    let encoded = option_env!("ARIES_LICENSE_PUBLIC_KEY")
        .unwrap_or(DEFAULT_LICENSE_PUBLIC_KEY)
        .trim();
    if encoded.is_empty() {
        return Err("license_public_key_unconfigured".to_string());
    }
    let raw = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "license_public_key_invalid".to_string())?;
    let bytes: [u8; 32] = raw
        .try_into()
        .map_err(|_| "license_public_key_invalid".to_string())?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "license_public_key_invalid".to_string())
}

fn device_digest(device_id: &str) -> String {
    let digest = Sha256::digest(device_id.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unix_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "system_clock_invalid".to_string())
}

fn verify_lease(token: &str, device_id: &str) -> Result<LeasePayload, String> {
    verify_lease_with_key(token, device_id, &public_key()?)
}

fn verify_lease_with_key(
    token: &str,
    device_id: &str,
    verifying_key: &VerifyingKey,
) -> Result<LeasePayload, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("license_lease_invalid".to_string());
    }
    let header_raw = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| "license_lease_invalid".to_string())?;
    let header: LeaseHeader =
        serde_json::from_slice(&header_raw).map_err(|_| "license_lease_invalid".to_string())?;
    if header.alg != "EdDSA" || header.typ != "ARIES-L1" {
        return Err("license_lease_invalid".to_string());
    }
    let signature_raw = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| "license_lease_invalid".to_string())?;
    let signature =
        Signature::from_slice(&signature_raw).map_err(|_| "license_lease_invalid".to_string())?;
    let signed = format!("{}.{}", parts[0], parts[1]);
    verifying_key
        .verify_strict(signed.as_bytes(), &signature)
        .map_err(|_| "license_lease_invalid".to_string())?;
    let payload_raw = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| "license_lease_invalid".to_string())?;
    let payload: LeasePayload =
        serde_json::from_slice(&payload_raw).map_err(|_| "license_lease_invalid".to_string())?;
    if payload.v != 1
        || payload.activation_id.is_empty()
        || payload.device != device_digest(device_id)
        || payload.exp <= payload.refresh_after
        || !payload.entitlements.iter().any(|item| item == "desktop")
    {
        return Err("license_lease_invalid".to_string());
    }
    Ok(payload)
}

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .user_agent("Aries-License")
        .build()
}

fn status_from_state(state: LocalState) -> Result<LicenseStatus, String> {
    let configured = server_url().is_ok() && public_key().is_ok();
    let Some(lease_token) = state.lease_token.as_deref() else {
        return Ok(LicenseStatus {
            configured,
            required: license_required(),
            state: if configured {
                "unlicensed"
            } else {
                "unconfigured"
            }
            .to_string(),
            activation_id: state.activation_id,
            provider: state.provider,
            seats: state.seats,
            lease_expires_at: state.lease_expires_at,
            refresh_after: state.refresh_after,
        });
    };
    let payload = match verify_lease(lease_token, &state.device_id) {
        Ok(payload) => payload,
        Err(_) => {
            return Ok(LicenseStatus {
                configured,
                required: license_required(),
                state: "invalid".to_string(),
                activation_id: state.activation_id,
                provider: state.provider,
                seats: state.seats,
                lease_expires_at: state.lease_expires_at,
                refresh_after: state.refresh_after,
            })
        }
    };
    if state.activation_id.as_deref() != Some(payload.activation_id.as_str()) {
        return Err("license_state_mismatch".to_string());
    }
    let now = unix_now()?;
    let license_state = if now >= payload.exp {
        "expired"
    } else if now >= payload.refresh_after {
        "grace"
    } else {
        "active"
    };
    Ok(LicenseStatus {
        configured,
        required: license_required(),
        state: license_state.to_string(),
        activation_id: state.activation_id,
        provider: state.provider,
        seats: state.seats,
        lease_expires_at: state.lease_expires_at,
        refresh_after: state.refresh_after,
    })
}

fn runtime_access_allowed(required: bool, state: &str) -> bool {
    !required || matches!(state, "active" | "grace")
}

pub(crate) fn daemon_access_allowed(app: &AppHandle<Wry>) -> bool {
    if !license_required() {
        return true;
    }
    match ensure_device_id(app).and_then(status_from_state) {
        Ok(status) => runtime_access_allowed(status.required, &status.state),
        Err(error) => {
            log::warn!("failed to verify local license state before daemon launch: {error}");
            false
        }
    }
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "x86") {
        "i686"
    } else {
        "armv7"
    }
}

#[cfg(test)]
fn normalize_update_version(version: &str) -> String {
    if let Some((base, beta)) = version.rsplit_once('b') {
        if beta.bytes().all(|byte| byte.is_ascii_digit())
            && base.split('.').count() == 3
            && base
                .split('.')
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        {
            return format!("{base}-beta.{beta}");
        }
    }
    version.to_string()
}

fn api_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(_, response) => response
            .into_json::<serde_json::Value>()
            .ok()
            .and_then(|payload| payload.get("detail")?.as_str().map(str::to_string))
            .unwrap_or_else(|| "license_request_rejected".to_string()),
        ureq::Error::Transport(_) => "license_server_unavailable".to_string(),
    }
}

fn apply_activation(
    app: &AppHandle<Wry>,
    mut state: LocalState,
    license_key: String,
    response: ActivationResponse,
) -> Result<LicenseStatus, String> {
    let rollback_token = response.activation_token.clone();
    if let Err(error) = verify_lease(&response.lease_token, &state.device_id) {
        rollback_remote_activation(&rollback_token, &state.device_id);
        return Err(error);
    }
    if let Err(error) = store_credentials(&CredentialSecret {
        license_key,
        activation_token: response.activation_token,
    }) {
        rollback_remote_activation(&rollback_token, &state.device_id);
        return Err(error);
    }
    state.activation_id = Some(response.activation_id);
    state.lease_token = Some(response.lease_token);
    state.lease_expires_at = Some(response.lease_expires_at);
    state.refresh_after = Some(response.refresh_after);
    state.provider = Some(response.provider);
    state.seats = Some(response.seats);
    write_local_state(app, &state)?;
    status_from_state(state)
}

fn rollback_remote_activation(activation_token: &str, device_id: &str) {
    let Ok(url) = server_url() else {
        return;
    };
    let _ = http_agent()
        .post(&format!("{url}/v1/licenses/deactivate"))
        .set("Authorization", &format!("Bearer {activation_token}"))
        .send_json(&DeactivationRequest {
            device_id: device_id.to_string(),
        });
}

fn activate_blocking(app: AppHandle<Wry>, license_key: String) -> Result<LicenseStatus, String> {
    let state = ensure_device_id(&app)?;
    let request = ActivationRequest {
        license_key: license_key.trim().to_string(),
        device_id: state.device_id.clone(),
        platform: platform().to_string(),
        arch: arch().to_string(),
    };
    let response = http_agent()
        .post(&format!("{}/v1/licenses/activate", server_url()?))
        .send_json(&request)
        .map_err(api_error)?
        .into_json::<ActivationResponse>()
        .map_err(|_| "license_server_invalid_response".to_string())?;
    apply_activation(&app, state, request.license_key, response)
}

fn refresh_blocking(app: AppHandle<Wry>) -> Result<LicenseStatus, String> {
    let mut state = ensure_device_id(&app)?;
    let secret = read_credentials()?.ok_or_else(|| "activation_required".to_string())?;
    let request = ActivationRequest {
        license_key: secret.license_key,
        device_id: state.device_id.clone(),
        platform: platform().to_string(),
        arch: arch().to_string(),
    };
    let response = match http_agent()
        .post(&format!("{}/v1/licenses/refresh", server_url()?))
        .set(
            "Authorization",
            &format!("Bearer {}", secret.activation_token),
        )
        .send_json(&request)
    {
        Ok(response) => response,
        Err(error) => {
            let code = api_error(error);
            if is_authoritative_license_rejection(&code) {
                clear_local_activation(&app, &mut state)?;
                if let Err(error) = clear_credentials() {
                    log::warn!(
                        "failed to remove rejected license credential after local lock: {error}"
                    );
                }
            }
            return Err(code);
        }
    }
    .into_json::<ActivationResponse>()
    .map_err(|_| "license_server_invalid_response".to_string())?;
    apply_activation(&app, state, request.license_key, response)
}

fn is_authoritative_license_rejection(code: &str) -> bool {
    matches!(
        code,
        "activation_invalid" | "license_inactive" | "license_not_found"
    )
}

#[tauri::command]
pub fn license_status(app: AppHandle<Wry>) -> Result<LicenseStatus, String> {
    status_from_state(ensure_device_id(&app)?)
}

#[tauri::command]
pub async fn license_activate(
    app: AppHandle<Wry>,
    license_key: String,
) -> Result<LicenseStatus, String> {
    let worker_app = app.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        activate_blocking(worker_app, license_key)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };
    crate::reconcile_daemon_license_gate(&app);
    result
}

#[tauri::command]
pub async fn license_refresh(app: AppHandle<Wry>) -> Result<LicenseStatus, String> {
    let worker_app = app.clone();
    let result =
        match tauri::async_runtime::spawn_blocking(move || refresh_blocking(worker_app)).await {
            Ok(result) => result,
            Err(error) => Err(error.to_string()),
        };
    crate::reconcile_daemon_license_gate(&app);
    result
}

fn management_license_key(provided: Option<String>) -> Result<String, String> {
    if let Some(key) = provided.map(|value| value.trim().to_string()) {
        if !key.is_empty() {
            return Ok(key);
        }
    }
    read_credentials()?
        .map(|secret| secret.license_key)
        .ok_or_else(|| "activation_required".to_string())
}

fn list_devices_blocking(
    app: AppHandle<Wry>,
    license_key: Option<String>,
) -> Result<LicenseDevices, String> {
    let state = ensure_device_id(&app)?;
    let request = DeviceListRequest {
        license_key: management_license_key(license_key)?,
        device_id: state.device_id,
    };
    http_agent()
        .post(&format!("{}/v1/licenses/devices/list", server_url()?))
        .send_json(&request)
        .map_err(api_error)?
        .into_json::<LicenseDevices>()
        .map_err(|_| "license_server_invalid_response".to_string())
}

#[tauri::command]
pub async fn license_list_devices(
    app: AppHandle<Wry>,
    license_key: Option<String>,
) -> Result<LicenseDevices, String> {
    tauri::async_runtime::spawn_blocking(move || list_devices_blocking(app, license_key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn license_revoke_device(
    app: AppHandle<Wry>,
    activation_id: String,
    license_key: Option<String>,
) -> Result<LicenseDevices, String> {
    let worker_app = app.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        let mut state = ensure_device_id(&worker_app)?;
        let request = DeviceRevokeRequest {
            license_key: management_license_key(license_key)?,
            device_id: state.device_id.clone(),
            activation_id,
        };
        let response = http_agent()
            .post(&format!("{}/v1/licenses/devices/revoke", server_url()?))
            .send_json(&request)
            .map_err(api_error)?
            .into_json::<LicenseDevices>()
            .map_err(|_| "license_server_invalid_response".to_string())?;
        if response.revoked_current {
            clear_local_activation(&worker_app, &mut state)?;
            if let Err(error) = clear_credentials() {
                log::warn!("failed to remove revoked license credential after local lock: {error}");
            }
        }
        Ok(response)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };
    crate::reconcile_daemon_license_gate(&app);
    result
}

fn clear_local_activation(app: &AppHandle<Wry>, state: &mut LocalState) -> Result<(), String> {
    state.activation_id = None;
    state.lease_token = None;
    state.lease_expires_at = None;
    state.refresh_after = None;
    state.provider = None;
    state.seats = None;
    write_local_state(app, state)
}

#[tauri::command]
pub async fn license_deactivate(app: AppHandle<Wry>) -> Result<LicenseStatus, String> {
    let worker_app = app.clone();
    let result = match tauri::async_runtime::spawn_blocking(move || {
        let mut state = ensure_device_id(&worker_app)?;
        // Clear the signed local lease first. Even if a legacy Keychain ACL or
        // an offline server prevents remote cleanup, deactivation must lock this
        // commercial build immediately and durably.
        clear_local_activation(&worker_app, &mut state)?;
        match read_credentials() {
            Ok(Some(secret)) => {
                if let Err(error) = http_agent()
                    .post(&format!("{}/v1/licenses/deactivate", server_url()?))
                    .set(
                        "Authorization",
                        &format!("Bearer {}", secret.activation_token),
                    )
                    .send_json(&DeactivationRequest {
                        device_id: state.device_id.clone(),
                    })
                {
                    log::warn!(
                        "remote license deactivation failed after local lock: {}",
                        api_error(error)
                    );
                }
                if let Err(error) = clear_credentials() {
                    log::warn!("failed to remove license credential after local lock: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => {
                // Do not attempt a second Keychain operation after access was
                // denied; that would produce another system password prompt.
                log::warn!("license credential unavailable after local lock: {error}");
            }
        }
        status_from_state(state)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };
    crate::reconcile_daemon_license_gate(&app);
    result
}

#[tauri::command]
pub async fn license_check_update(
    app: AppHandle<Wry>,
    pending_update: State<'_, PendingLicenseUpdate>,
    channel: Option<String>,
) -> Result<Option<UpdateInfo>, String> {
    let state = ensure_device_id(&app)?;
    let status = status_from_state(read_local_state(&app)?)?;
    if !matches!(status.state.as_str(), "active" | "grace") {
        return Err("activation_required".to_string());
    }
    let secret = read_credentials()?.ok_or_else(|| "activation_required".to_string())?;
    let channel = channel.unwrap_or_else(|| "stable".to_string());
    if !matches!(channel.as_str(), "stable" | "beta") {
        return Err("update_channel_invalid".to_string());
    }
    let endpoint = Url::parse(&format!(
        "{}/v1/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}?channel={channel}",
        server_url()?
    ))
    .map_err(|_| "update_endpoint_invalid".to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .header(
            "Authorization",
            format!("Bearer {}", secret.activation_token),
        )
        .map_err(|error| error.to_string())?
        .header("X-Aries-Device-ID", state.device_id)
        .map_err(|error| error.to_string())?
        // The updater retains this client for the artifact transfer. Keep
        // connection failures prompt without timing out a large signed archive.
        .timeout(UPDATE_TRANSFER_TIMEOUT)
        .configure_client(|builder| builder.connect_timeout(UPDATE_CONNECT_TIMEOUT))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    let metadata = update.as_ref().map(|next| UpdateInfo {
        version: next.version.clone(),
        notes: next.body.clone().unwrap_or_default(),
        pub_date: next.date.map(|value| value.to_string()),
    });
    let mut update = update;
    if let Some(next) = update.as_mut() {
        // The bearer token authenticates the metadata request only. Update bundles
        // live on a separate download host and must never receive Keychain secrets.
        next.headers.clear();
    }
    *pending_update
        .0
        .lock()
        .map_err(|_| "update_state_unavailable".to_string())? = update;
    Ok(metadata)
}

#[tauri::command]
pub async fn license_install_update(
    pending_update: State<'_, PendingLicenseUpdate>,
    on_event: Channel<UpdateInstallEvent>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|_| "update_state_unavailable".to_string())?
        .take()
        .ok_or_else(|| "update_not_available".to_string())?;
    let finish_channel = on_event.clone();
    let installed_channel = on_event.clone();
    let mut started = false;
    let mut downloaded = 0_usize;
    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(UpdateInstallEvent::Started { content_length });
                    started = true;
                }
                downloaded = downloaded.saturating_add(chunk_length);
                let _ = on_event.send(UpdateInstallEvent::Progress {
                    chunk_length,
                    downloaded,
                });
            },
            move || {
                let _ = finish_channel.send(UpdateInstallEvent::Finished);
            },
        )
        .await
        .map_err(|error| {
            log::error!("licensed update download/install failed: {error}");
            error.to_string()
        })?;
    let _ = installed_channel.send(UpdateInstallEvent::Installed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn device_digest_matches_server_hex_contract() {
        assert_eq!(
            device_digest("device-0000000000000001"),
            "42c66bc2d7eb1ed9573b8a845f194ad5428161ad9a409d20a031dbbe218d13c2"
        );
    }

    #[test]
    fn random_device_id_has_uuid_v4_shape() {
        let id = random_device_id().expect("random device id");
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn signed_lease_round_trip_and_tamper_rejection() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","typ":"ARIES-L1"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&serde_json::json!({
                "v": 1,
                "activation_id": "activation-1",
                "device": device_digest("device-0000000000000001"),
                "entitlements": ["desktop", "updates"],
                "refresh_after": 100,
                "exp": 200
            }))
            .expect("test payload serializes"),
        );
        let signed = format!("{header}.{payload}");
        let signature = URL_SAFE_NO_PAD.encode(signing_key.sign(signed.as_bytes()).to_bytes());
        let token = format!("{signed}.{signature}");
        assert!(verify_lease_with_key(
            &token,
            "device-0000000000000001",
            &signing_key.verifying_key()
        )
        .is_ok());
        assert!(verify_lease_with_key(
            &format!("{signed}.{signature}x"),
            "device-0000000000000001",
            &signing_key.verifying_key()
        )
        .is_err());
    }

    #[test]
    fn updater_version_is_valid_semver_for_legacy_beta_label() {
        assert_eq!(normalize_update_version("1.0.0b1"), "1.0.0-beta.1");
        assert_eq!(normalize_update_version("1.0.0"), "1.0.0");
    }

    #[test]
    fn updater_allows_large_signed_archives_to_finish() {
        assert_eq!(UPDATE_CONNECT_TIMEOUT, Duration::from_secs(12));
        assert!(UPDATE_TRANSFER_TIMEOUT >= Duration::from_secs(30 * 60));
    }

    #[test]
    fn release_builds_fail_closed_without_an_explicit_license_flag() {
        assert!(license_required_from_config(None, false, false));
        assert!(!license_required_from_config(None, true, false));
        assert!(license_required_from_config(Some("1"), true, false));
        assert!(!license_required_from_config(Some("0"), false, false));
    }

    #[test]
    fn windows_release_builds_cannot_disable_the_license_gate() {
        assert!(license_required_from_config(None, false, true));
        assert!(license_required_from_config(Some("0"), false, true));
        assert!(license_required_from_config(Some("1"), false, true));
        assert!(!license_required_from_config(Some("0"), true, true));
    }

    #[test]
    fn daemon_runtime_requires_a_valid_local_lease_for_commercial_builds() {
        assert!(runtime_access_allowed(true, "active"));
        assert!(runtime_access_allowed(true, "grace"));
        for state in ["unconfigured", "unlicensed", "invalid", "expired"] {
            assert!(!runtime_access_allowed(true, state), "{state}");
        }
        for state in ["unconfigured", "unlicensed", "invalid", "expired"] {
            assert!(runtime_access_allowed(false, state), "{state}");
        }
    }

    #[test]
    fn debug_and_release_credentials_are_isolated() {
        assert_ne!(
            PRODUCTION_CREDENTIAL_SERVICE,
            DEVELOPMENT_CREDENTIAL_SERVICE
        );
        assert_ne!(PRODUCTION_LOCAL_STATE_FILE, DEVELOPMENT_LOCAL_STATE_FILE);
    }

    #[test]
    fn authoritative_rejections_lock_locally_but_network_failures_do_not() {
        assert!(is_authoritative_license_rejection("activation_invalid"));
        assert!(is_authoritative_license_rejection("license_inactive"));
        assert!(!is_authoritative_license_rejection(
            "license_server_unavailable"
        ));
    }
}
