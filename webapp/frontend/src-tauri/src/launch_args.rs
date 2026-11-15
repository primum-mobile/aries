// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Files named on a second launch's command line (Explorer "Open with", a file
//! dropped on the shortcut, a script). The single-instance plugin hands the
//! running Aries the second process's argv and working directory; this keeps
//! only the arguments that name existing files, made absolute against that
//! directory, so the main window can be told about them. Pure and host-tested.

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::path::{Path, PathBuf};

/// Event sent to the main webview with the forwarded file paths.
pub(crate) const OPEN_FILES_EVENT: &str = "aries://open-files";

/// Existing files named in a forwarded argv. `argv[0]` (the executable) and
/// option-like arguments (`-x`, `--x`, `/X` without a path separator after the
/// first character) are skipped; relative paths resolve against `cwd`;
/// duplicates keep their first position.
pub(crate) fn forwarded_file_args(argv: &[String], cwd: &str) -> Vec<PathBuf> {
    let base = Path::new(cwd);
    let mut files: Vec<PathBuf> = Vec::new();
    for argument in argv.iter().skip(1) {
        let argument = argument.trim();
        if argument.is_empty() || is_option(argument) {
            continue;
        }
        let path = Path::new(argument);
        let path = if path.is_absolute() || cwd.is_empty() {
            path.to_path_buf()
        } else {
            base.join(path)
        };
        if path.is_file() && !files.contains(&path) {
            files.push(path);
        }
    }
    files
}

fn is_option(argument: &str) -> bool {
    if argument.starts_with('-') {
        return true;
    }
    // Windows-style switches such as `/UPDATE`; `/home/x` (a POSIX path) has a
    // second separator and stays a path.
    argument
        .strip_prefix('/')
        .is_some_and(|rest| !rest.contains(['/', '\\']))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aries-launch-args-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keeps_existing_files_in_order_and_resolves_relative_paths() {
        let dir = scratch_dir("files");
        fs::write(dir.join("a.jsonl"), "").unwrap();
        fs::write(dir.join("b.hor"), "").unwrap();
        let absolute = dir.join("b.hor").to_string_lossy().into_owned();
        let argv = vec![
            "Aries.exe".to_string(),
            "a.jsonl".to_string(),
            absolute.clone(),
            "a.jsonl".to_string(),
        ];
        let files = forwarded_file_args(&argv, &dir.to_string_lossy());
        assert_eq!(files, vec![dir.join("a.jsonl"), PathBuf::from(absolute)]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn skips_the_executable_options_folders_and_missing_files() {
        let dir = scratch_dir("skips");
        fs::create_dir_all(dir.join("folder")).unwrap();
        fs::write(dir.join("-dash"), "").unwrap();
        let argv = vec![
            dir.join("-dash").to_string_lossy().into_owned(),
            "--flag".to_string(),
            "-dash".to_string(),
            "/UPDATE".to_string(),
            "folder".to_string(),
            "missing.jsonl".to_string(),
            "  ".to_string(),
        ];
        assert!(forwarded_file_args(&argv, &dir.to_string_lossy()).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn switches_and_paths_are_told_apart() {
        assert!(is_option("/UPDATE"));
        assert!(is_option("-x"));
        assert!(!is_option("/home/max/chart.jsonl"));
        assert!(!is_option("C:\\Charts\\a.jsonl"));
        assert!(!is_option("chart.jsonl"));
    }
}
