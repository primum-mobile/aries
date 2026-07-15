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

fn main() {
    for key in [
        "ARIES_RELEASE_VERSION",
        "ARIES_LICENSE_REQUIRED",
        "ARIES_LICENSE_SERVER_URL",
        "ARIES_LICENSE_PUBLIC_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                require_printable_ascii(key, &value);
            }
            match key {
                "ARIES_RELEASE_VERSION" if !value.is_empty() => require_release_version(&value),
                "ARIES_LICENSE_REQUIRED" if !matches!(value.as_str(), "0" | "1") => {
                    panic!("ARIES_LICENSE_REQUIRED must be 0 or 1")
                }
                _ => {}
            }
            println!("cargo:rustc-env={key}={value}");
        }
    }
    tauri_build::build()
}
