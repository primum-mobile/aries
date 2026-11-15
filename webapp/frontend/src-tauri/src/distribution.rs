// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Compile-time distribution channel.
//!
//! `ARIES_DISTRIBUTION=store` marks the Microsoft Store MSIX build. The Store
//! installs and updates that package, so the in-app updater must stay off
//! there (a Tauri NSIS update would install outside the package). Every other
//! build, including an unset variable, is a direct download that updates
//! itself. The serial-key gate is the same for both.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Distribution {
    Direct,
    Store,
}

impl Distribution {
    fn from_compiled(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("store") => Self::Store,
            _ => Self::Direct,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Store => "store",
        }
    }

    pub fn self_updates(self) -> bool {
        self == Self::Direct
    }
}

pub fn current() -> Distribution {
    Distribution::from_compiled(option_env!("ARIES_DISTRIBUTION"))
}

pub(crate) fn validate_store_distribution() -> Result<(), String> {
    if current() == Distribution::Store {
        Ok(())
    } else {
        Err(format!(
            "distribution_not_store (compiled as {})",
            current().as_str()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_explicit_store_build_disables_self_updates() {
        assert_eq!(Distribution::from_compiled(None), Distribution::Direct);
        assert_eq!(Distribution::from_compiled(Some("")), Distribution::Direct);
        assert_eq!(Distribution::from_compiled(Some("direct")), Distribution::Direct);
        assert_eq!(Distribution::from_compiled(Some("store")), Distribution::Store);
        assert!(Distribution::Direct.self_updates());
        assert!(!Distribution::Store.self_updates());
    }

    #[test]
    fn webview_receives_a_stable_channel_name() {
        assert_eq!(Distribution::Direct.as_str(), "direct");
        assert_eq!(Distribution::Store.as_str(), "store");
    }
}
