// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

fn require_printable_ascii(key: &str, value: &str) {
    if value.bytes().any(|byte| !(0x20..=0x7e).contains(&byte)) {
        panic!("{key} must contain printable ASCII only");
    }
}

fn require_release_version(value: &str) {
    if value
        .bytes()
        .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'.' | b'-' | b'+'))
    {
        panic!("ARIES_RELEASE_VERSION must be an ASCII version token");
    }
}

fn require_windows_release_license_contract() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if target_os != "windows" || profile != "release" {
        return;
    }

    let license_required = std::env::var("ARIES_LICENSE_REQUIRED").unwrap_or_default();
    if license_required != "1" {
        panic!("Windows release builds require ARIES_LICENSE_REQUIRED=1");
    }
    let server_url = std::env::var("ARIES_LICENSE_SERVER_URL").unwrap_or_default();
    if !server_url.starts_with("https://") {
        panic!("Windows release builds require an HTTPS ARIES_LICENSE_SERVER_URL");
    }
    let public_key = std::env::var("ARIES_LICENSE_PUBLIC_KEY").unwrap_or_default();
    if public_key.len() != 43
        || public_key
            .bytes()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'_' | b'-'))
    {
        panic!("Windows release builds require a valid Ed25519 ARIES_LICENSE_PUBLIC_KEY");
    }
}

fn require_rehearsal_only_update_override() {
    // The update-rehearsal feature points the updater at a local test server
    // (src/update_rehearsal.rs). Only rehearsal versions may carry it.
    if std::env::var_os("CARGO_FEATURE_UPDATE_REHEARSAL").is_none() {
        return;
    }
    let version = std::env::var("ARIES_RELEASE_VERSION").unwrap_or_default();
    if !version.contains("-rehearsal.") {
        panic!("the update-rehearsal feature requires an ARIES_RELEASE_VERSION like 1.0.0-rehearsal.1");
    }
}

fn require_rehearsal_only_licence_bypass() {
    // The ci-licence-bypass feature lets a CI runner open the app past the
    // serial gate (src/ci_licence_bypass.rs). Only rehearsal versions, never
    // a version a customer could install, may carry it.
    if std::env::var_os("CARGO_FEATURE_CI_LICENCE_BYPASS").is_none() {
        return;
    }
    let version = std::env::var("ARIES_RELEASE_VERSION").unwrap_or_default();
    if !version.contains("-rehearsal.") {
        panic!("the ci-licence-bypass feature requires an ARIES_RELEASE_VERSION like 1.0.0-rehearsal.1");
    }
    if std::env::var("ARIES_DISTRIBUTION").unwrap_or_default() == "store" {
        panic!("the ci-licence-bypass feature is not allowed in Microsoft Store builds");
    }
}

fn main() {
    require_windows_release_license_contract();
    require_rehearsal_only_update_override();
    require_rehearsal_only_licence_bypass();
    for key in [
        "ARIES_RELEASE_VERSION",
        "ARIES_BETA_BUILD_ID",
        "ARIES_LICENSE_REQUIRED",
        "ARIES_LICENSE_SERVER_URL",
        "ARIES_LICENSE_PUBLIC_KEY",
        "ARIES_DISTRIBUTION",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                require_printable_ascii(key, &value);
            }
            match key {
                "ARIES_RELEASE_VERSION" | "ARIES_BETA_BUILD_ID" if !value.is_empty() => {
                    require_release_version(&value)
                }
                "ARIES_LICENSE_REQUIRED" if !matches!(value.as_str(), "0" | "1") => {
                    panic!("ARIES_LICENSE_REQUIRED must be 0 or 1")
                }
                // `store` builds (Microsoft Store MSIX) leave updates to the
                // Store; every other build is a direct download.
                "ARIES_DISTRIBUTION" if !matches!(value.as_str(), "" | "direct" | "store") => {
                    panic!("ARIES_DISTRIBUTION must be direct or store")
                }
                _ => {}
            }
            println!("cargo:rustc-env={key}={value}");
        }
    }
    tauri_build::build()
}
