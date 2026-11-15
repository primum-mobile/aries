// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! In-process minidumps for Aries.exe (Windows only).
//!
//! The installer also asks Windows Error Reporting for LocalDumps under HKCU
//! (`windows/installer-hooks.nsh`), but WER may ignore per-user LocalDumps
//! (group policy, a disabled WER service, a managed machine). So the shell
//! writes its own minidump to `%LOCALAPPDATA%\Aries\crashdumps`:
//!
//! - from the panic hook, before `panic = "abort"` ends the process. The
//!   abort is a fail-fast, which skips unhandled-exception filters;
//! - from an unhandled-exception filter, for native faults (an access
//!   violation in a system or WebView2 library, for example). The filter then
//!   lets the exception continue to WER.
//!
//! The folder keeps at most [`MAX_DUMPS`] dumps, ours and WER's together; the
//! diagnostics report counts them. The daemon has Python's faulthandler.

use std::fs::{self, File};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Diagnostics::Debug::{
    MiniDumpWithThreadInfo, MiniDumpWithUnloadedModules, MiniDumpWriteDump,
    SetUnhandledExceptionFilter, EXCEPTION_POINTERS, MINIDUMP_EXCEPTION_INFORMATION,
};
use windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId};

/// Dumps kept in the folder, matching the installer's WER `DumpCount`.
pub(crate) const MAX_DUMPS: usize = 5;
/// `EXCEPTION_CONTINUE_SEARCH`: WER and the debugger still see the fault.
const EXCEPTION_CONTINUE_SEARCH: i32 = 0;

static DUMP_DIR: OnceLock<PathBuf> = OnceLock::new();
/// One dump per process: a fault while dumping must not recurse.
static DUMPED: AtomicBool = AtomicBool::new(false);

/// Remembers the folder and installs the unhandled-exception filter.
pub(crate) fn install(dir: PathBuf) {
    let _ = DUMP_DIR.set(dir);
    // SAFETY: the filter is a plain `extern "system"` function that lives for
    // the whole process.
    unsafe {
        SetUnhandledExceptionFilter(Some(unhandled_exception));
    }
}

unsafe extern "system" fn unhandled_exception(info: *const EXCEPTION_POINTERS) -> i32 {
    // The faulting thread writes the dump itself, with its exception record.
    let _ = write_dump("fault", info);
    EXCEPTION_CONTINUE_SEARCH
}

/// Writes a dump for a shell panic. Only release builds (`panic = "abort"`)
/// end the process on a panic; unwinding builds may catch it, so they skip.
pub(crate) fn write_panic_dump() {
    if !cfg!(panic = "abort") {
        return;
    }
    // From a helper thread, so the panicking thread's stack is recorded
    // intact while it waits here.
    let _ = std::thread::Builder::new()
        .name("aries-crash-dump".into())
        .spawn(|| {
            let _ = write_dump("panic", std::ptr::null());
        })
        .map(|handle| handle.join());
}

fn write_dump(kind: &str, exception: *const EXCEPTION_POINTERS) -> Option<PathBuf> {
    if DUMPED.swap(true, Ordering::SeqCst) {
        return None;
    }
    let dir = DUMP_DIR.get()?;
    fs::create_dir_all(dir).ok()?;
    prune_dumps(dir, MAX_DUMPS - 1);
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    // SAFETY: plain process and thread queries.
    let (process, process_id, thread_id) =
        unsafe { (GetCurrentProcess(), GetCurrentProcessId(), GetCurrentThreadId()) };
    let path = dir.join(format!("aries-shell.{process_id}.{seconds}.{kind}.dmp"));
    let file = File::create(&path).ok()?;
    let exception_info = MINIDUMP_EXCEPTION_INFORMATION {
        ThreadId: thread_id,
        ExceptionPointers: exception.cast_mut(),
        ClientPointers: false.into(),
    };
    let exception_param = (!exception.is_null()).then_some(&raw const exception_info);
    // SAFETY: the file handle stays open for the call; the exception
    // information, when given, points at this process's live records.
    let written = unsafe {
        MiniDumpWriteDump(
            process,
            process_id,
            HANDLE(file.as_raw_handle()),
            MiniDumpWithThreadInfo | MiniDumpWithUnloadedModules,
            exception_param,
            None,
            None,
        )
    };
    drop(file);
    if written.is_err() {
        let _ = fs::remove_file(&path);
        return None;
    }
    Some(path)
}

/// Deletes the oldest `.dmp` files so at most `keep` remain.
pub(crate) fn prune_dumps(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut dumps: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dmp"))
        })
        .map(|path| {
            let modified = fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .unwrap_or(UNIX_EPOCH);
            (modified, path)
        })
        .collect();
    dumps.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in dumps.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pruning_keeps_the_newest_dumps_and_other_files() {
        let dir = std::env::temp_dir().join(format!("aries-dump-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for index in 0..4 {
            let path = dir.join(format!("Aries.exe.{index}.dmp"));
            fs::write(&path, b"x").unwrap();
            let modified = UNIX_EPOCH + std::time::Duration::from_secs(1_000 + index);
            File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
        }
        fs::write(dir.join("notes.txt"), b"keep").unwrap();
        prune_dumps(&dir, 2);
        let mut left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["Aries.exe.2.dmp", "Aries.exe.3.dmp", "notes.txt"]);
        let _ = fs::remove_dir_all(&dir);
    }
}
