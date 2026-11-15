// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Frontend assets served from the app's resource directory.
//!
//! Tauri embeds the whole frontend in the executable, once per architecture.
//! The large static media (fonts, astrolabe plates, Urania art) would make up
//! most of that, twice in a universal build, so packaging leaves it out of the
//! embedded copy and ships it once as bundle resources instead
//! (`scripts/stage_tauri_frontend_dist.py`). This provider answers the same
//! asset URLs from those files, so the frontend is unchanged.
//!
//! Lookups go only through the staged manifest: an asset key that it does not
//! list is never read from disk.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Runtime};

/// Resource-relative location of the manifest written by the staging script.
pub const MANIFEST_RESOURCE_PATH: &str = "frontend-media/manifest.json";
const MANIFEST_VERSION: u32 = 1;

#[derive(Deserialize)]
struct Manifest {
    version: u32,
    /// Asset key (`/fonts/Name.ttf`) to resource-relative file path.
    assets: HashMap<String, String>,
}

/// Asset keys mapped to absolute files below the resource directory.
#[derive(Debug, Default, PartialEq)]
pub struct MediaIndex {
    files: HashMap<String, PathBuf>,
}

fn is_plain_relative_path(path: &Path) -> bool {
    path.components().next().is_some()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

impl MediaIndex {
    /// Parse a staged manifest. Entries that are not plain relative paths
    /// below `resource_dir` are rejected as a whole-manifest error.
    pub fn from_manifest(json: &str, resource_dir: &Path) -> Result<Self, String> {
        let manifest: Manifest =
            serde_json::from_str(json).map_err(|error| format!("invalid manifest: {error}"))?;
        if manifest.version != MANIFEST_VERSION {
            return Err(format!("unsupported manifest version {}", manifest.version));
        }
        let mut files = HashMap::with_capacity(manifest.assets.len());
        for (key, relative) in manifest.assets {
            let relative_path = Path::new(&relative);
            if !key.starts_with('/') || !is_plain_relative_path(relative_path) {
                return Err(format!("invalid manifest entry {key:?} -> {relative:?}"));
            }
            files.insert(key, resource_dir.join(relative_path));
        }
        Ok(Self { files })
    }

    /// Load the manifest from a resource directory. A bundle without one
    /// (development, or a build that embeds everything) has no external media.
    pub fn load(resource_dir: &Path) -> Result<Self, String> {
        let manifest_path = resource_dir.join(MANIFEST_RESOURCE_PATH);
        match std::fs::read_to_string(&manifest_path) {
            Ok(json) => Self::from_manifest(&json, resource_dir),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(format!("{}: {error}", manifest_path.display())),
        }
    }

    pub fn len(&self) -> usize {
        self.files.len()
    }

    fn read(&self, key: &str) -> Option<Vec<u8>> {
        let path = self.files.get(key)?;
        match std::fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) => {
                log::error!(
                    "frontend media {key} unreadable at {}: {error}",
                    path.display()
                );
                None
            }
        }
    }
}

/// Stand-in used only while the embedded assets are moved into the provider.
pub struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// The embedded frontend first, then the bundle's staged media files.
pub struct ResourceBackedAssets<R: Runtime> {
    embedded: Box<dyn Assets<R>>,
    media: OnceLock<MediaIndex>,
    resource_dir: fn(&App<R>) -> Option<PathBuf>,
}

impl<R: Runtime> ResourceBackedAssets<R> {
    pub fn new(embedded: Box<dyn Assets<R>>, resource_dir: fn(&App<R>) -> Option<PathBuf>) -> Self {
        Self {
            embedded,
            media: OnceLock::new(),
            resource_dir,
        }
    }
}

impl<R: Runtime> Assets<R> for ResourceBackedAssets<R> {
    fn setup(&self, app: &App<R>) {
        self.embedded.setup(app);
        let index = match (self.resource_dir)(app) {
            Some(resource_dir) => MediaIndex::load(&resource_dir).unwrap_or_else(|error| {
                log::error!("frontend media manifest rejected: {error}");
                MediaIndex::default()
            }),
            None => MediaIndex::default(),
        };
        if index.len() > 0 {
            log::info!(
                "serving {} frontend media files from resources",
                index.len()
            );
        }
        let _ = self.media.set(index);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        if let Some(asset) = self.embedded.get(key) {
            return Some(asset);
        }
        self.media
            .get()
            .and_then(|media| media.read(key.as_ref()))
            .map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_resource_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aries-frontend-media-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("frontend-media/fonts")).unwrap();
        std::fs::create_dir_all(dir.join("Res")).unwrap();
        dir
    }

    #[test]
    fn manifest_maps_asset_keys_to_resource_files() {
        let dir = temp_resource_dir("lookup");
        std::fs::write(dir.join("frontend-media/fonts/Kosugi.ttf"), b"kosugi").unwrap();
        std::fs::write(dir.join("Res/FreeSans.ttf"), b"freesans").unwrap();
        std::fs::write(
            dir.join(MANIFEST_RESOURCE_PATH),
            r#"{"version":1,"assets":{
                "/fonts/Kosugi.ttf":"frontend-media/fonts/Kosugi.ttf",
                "/fonts/FreeSans.ttf":"Res/FreeSans.ttf"}}"#,
        )
        .unwrap();

        let index = MediaIndex::load(&dir).unwrap();
        assert_eq!(index.len(), 2);
        assert_eq!(
            index.read("/fonts/Kosugi.ttf").as_deref(),
            Some(&b"kosugi"[..])
        );
        assert_eq!(
            index.read("/fonts/FreeSans.ttf").as_deref(),
            Some(&b"freesans"[..])
        );
        // Only listed keys are ever read from disk.
        assert_eq!(index.read("/Res/FreeSans.ttf"), None);
        assert_eq!(index.read("/fonts/../Res/FreeSans.ttf"), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_manifest_means_no_external_media() {
        let dir = temp_resource_dir("missing");
        assert_eq!(MediaIndex::load(&dir).unwrap(), MediaIndex::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn manifest_entries_cannot_leave_the_resource_directory() {
        let dir = Path::new("/resources");
        for target in ["../secret", "/etc/passwd", "Res/../../secret", ""] {
            let json = format!(r#"{{"version":1,"assets":{{"/fonts/a.ttf":"{target}"}}}}"#);
            assert!(MediaIndex::from_manifest(&json, dir).is_err(), "{target}");
        }
        let unknown_version = r#"{"version":2,"assets":{}}"#;
        assert!(MediaIndex::from_manifest(unknown_version, dir).is_err());
        let relative_key = r#"{"version":1,"assets":{"fonts/a.ttf":"Res/a.ttf"}}"#;
        assert!(MediaIndex::from_manifest(relative_key, dir).is_err());
    }
}
