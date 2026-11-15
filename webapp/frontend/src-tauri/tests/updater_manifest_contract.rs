// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The updater manifest our release code writes must parse with the
//! tauri-plugin-updater version the app ships.
//!
//! The fixtures are produced by services/licensing/deploy/build_release_manifest.py
//! (a macOS release joined by the Windows installer) and by the license
//! server's ReleaseCatalog.update_for; tests/test_windows_release_rehearsal.py
//! regenerates them with that code and fails if they drift.

use tauri_plugin_updater::{RemoteRelease, RemoteReleaseInner};

const MANIFEST: &str = include_str!("fixtures/windows-release-manifest.json");
const RESPONSE: &str = include_str!("fixtures/windows-update-response.json");
const WINDOWS_URL: &str = "https://downloads.example.test/licensed/Aries-9.8.7-beta.3-windows-x86_64-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef-setup.exe";

#[test]
fn license_server_windows_response_parses_as_a_dynamic_release() {
    let release: RemoteRelease = serde_json::from_str(RESPONSE).expect("server response parses");
    assert_eq!(release.version.to_string(), "9.8.7-beta.3");
    assert!(release.version > "9.8.7-beta.2".parse().expect("semver"));
    assert_eq!(release.notes.as_deref(), Some("Fixture notes."));
    assert!(release.pub_date.is_some());
    assert!(matches!(release.data, RemoteReleaseInner::Dynamic(_)));
    // The app asks for {target}-{arch}; a dynamic answer ignores the key.
    assert_eq!(
        release.download_url("windows-x86_64").expect("url").as_str(),
        WINDOWS_URL
    );
    assert_eq!(
        release.signature("windows-x86_64-nsis").expect("signature"),
        "fixture-windows-signature"
    );
}

#[test]
fn published_release_entry_parses_as_a_static_manifest_with_the_nsis_key() {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).expect("manifest JSON");
    let channel = manifest["channels"]["beta"].clone();
    let release: RemoteRelease = serde_json::from_value(channel).expect("static release parses");
    assert_eq!(release.version.to_string(), "9.8.7-beta.3");
    assert!(release.pub_date.is_some());
    assert!(matches!(release.data, RemoteReleaseInner::Static { .. }));
    // Tauri's static reader tries the installer-qualified key first.
    for key in ["windows-x86_64-nsis", "windows-x86_64"] {
        assert_eq!(release.download_url(key).expect(key).as_str(), WINDOWS_URL);
        assert_eq!(
            release.signature(key).expect(key),
            "fixture-windows-signature"
        );
    }
    assert!(release.download_url("windows-aarch64-nsis").is_err());
}
