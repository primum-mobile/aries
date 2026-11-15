// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Windows daemon lifetime: the Python sidecar runs inside a Job Object that
//! the kernel tears down with the app.
//!
//! Anything the daemon starts is in the job too and ends with the app, so the
//! daemon must never launch a program meant to outlive Aries (a viewer, a
//! browser). Links and files are opened by the Tauri shell, outside the job.
//!
//! Windows does not end child processes when their parent exits, and
//! `RunEvent::Exit` is skipped by a crash, Task Manager, or the updater's
//! `std::process::exit`. Each daemon is therefore spawned suspended, assigned
//! to its own job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and only then
//! resumed, so the dev venv launcher's child and every helper the daemon
//! starts (table PDF export, pmtiles) inherit the job before any of them run.
//! The job handle is non-inheritable and held only by this process: when the
//! app exits by any path, the kernel closes it and ends the whole tree.
//!
//! The daemon is never spawned with `CREATE_BREAKAWAY_FROM_JOB`. When the app
//! itself runs inside a job (a terminal, CI or launcher job), Windows 8 and
//! later nest the daemon's job inside it, while breakaway would fail with
//! access denied unless the outer job allowed it. If the job cannot be
//! created or assigned, the daemon still starts and the Python parent
//! watchdog (`webapp/daemon/parent_watch.py`) remains the backstop.

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::Mutex;

use windows::Win32::Foundation::{FILETIME, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetProcessTimes, OpenThread, ResumeThread, CREATE_SUSPENDED,
    THREAD_SUSPEND_RESUME,
};

/// Creation time of the app process (FILETIME ticks), so the daemon can tell
/// its real parent from an unrelated process that reused the PID.
pub const PARENT_CREATED_ENV: &str = "ARIES_DAEMON_PARENT_CREATED";

/// The job of the most recently spawned daemon. Replacing or releasing it
/// closes the handle, which ends whatever is left of that daemon's tree.
static DAEMON_JOB: Mutex<Option<OwnedHandle>> = Mutex::new(None);

fn raw(handle: &impl AsRawHandle) -> HANDLE {
    HANDLE(handle.as_raw_handle())
}

fn create_kill_on_close_job() -> io::Result<OwnedHandle> {
    // SAFETY: a null name and null security attributes create an anonymous,
    // non-inheritable job; the returned handle is owned from here on.
    let job = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }
        .map_err(io::Error::other)?;
    let job = unsafe { OwnedHandle::from_raw_handle(job.0) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: `limits` is a valid JOBOBJECT_EXTENDED_LIMIT_INFORMATION of the
    // stated size for the duration of the call.
    unsafe {
        SetInformationJobObject(
            raw(&job),
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(io::Error::other)?;
    Ok(job)
}

/// Resume every thread of a process created with `CREATE_SUSPENDED`; a fresh
/// process has exactly one. `std` does not expose the primary thread handle.
fn resume_suspended_process(pid: u32) -> io::Result<()> {
    // SAFETY: the snapshot and thread handles are owned and closed on drop;
    // `entry` is a correctly sized THREADENTRY32.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0).map_err(io::Error::other)?;
        let snapshot = OwnedHandle::from_raw_handle(snapshot.0);
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut resumed = 0_usize;
        let mut next = Thread32First(raw(&snapshot), &mut entry);
        while next.is_ok() {
            if entry.th32OwnerProcessID == pid {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                    .map_err(io::Error::other)?;
                let thread = OwnedHandle::from_raw_handle(thread.0);
                if ResumeThread(raw(&thread)) == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                resumed += 1;
            }
            next = Thread32Next(raw(&snapshot), &mut entry);
        }
        if resumed == 0 {
            return Err(io::Error::other(format!("no threads found for pid {pid}")));
        }
    }
    Ok(())
}

fn replace_daemon_job(job: Option<OwnedHandle>) {
    match DAEMON_JOB.lock() {
        // Dropping the previous handle ends anything left of the old tree.
        Ok(mut current) => drop(std::mem::replace(&mut *current, job)),
        Err(poisoned) => drop(std::mem::replace(&mut *poisoned.into_inner(), job)),
    }
}

/// Spawn the daemon inside a fresh kill-on-close job.
///
/// `creation_flags` are the caller's flags (for example `CREATE_NO_WINDOW`);
/// `CREATE_SUSPENDED` is added here and the process is always resumed or
/// killed before this returns.
pub fn spawn_in_kill_on_close_job(command: &mut Command, creation_flags: u32) -> io::Result<Child> {
    let job = match create_kill_on_close_job() {
        Ok(job) => job,
        Err(error) => {
            log::warn!("aries daemon job object unavailable ({error}); relying on the parent watchdog");
            command.creation_flags(creation_flags);
            return command.spawn();
        }
    };
    command.creation_flags(creation_flags | CREATE_SUSPENDED.0);
    let mut child = command.spawn()?;
    // SAFETY: both handles are valid and owned for the duration of the call.
    let assigned = unsafe { AssignProcessToJobObject(raw(&job), raw(&child)) };
    if let Err(error) = &assigned {
        log::warn!(
            "failed to assign aries daemon pid {} to its job object ({error}); relying on the parent watchdog",
            child.id()
        );
    }
    if let Err(error) = resume_suspended_process(child.id()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(io::Error::other(format!("failed to resume aries daemon: {error}")));
    }
    if assigned.is_ok() {
        replace_daemon_job(Some(job));
    }
    Ok(child)
}

/// End the current daemon job, killing any helper processes the stopped
/// daemon left behind.
pub fn release_daemon_job() {
    replace_daemon_job(None);
}

fn current_process_creation_time() -> Option<u64> {
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: the pseudo-handle is always valid; the out-pointers are live.
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    }
    .ok()?;
    Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}

/// Tell the daemon the app's creation time alongside its PID.
pub fn apply_parent_identity(command: &mut Command) {
    if let Some(created) = current_process_creation_time() {
        command.env(PARENT_CREATED_ENV, created.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use windows::Win32::System::JobObjects::IsProcessInJob;

    fn in_job(child: &Child, job: &OwnedHandle) -> bool {
        let mut result = windows::core::BOOL(0);
        unsafe { IsProcessInJob(raw(child), Some(raw(job)), &mut result) }.unwrap();
        result.as_bool()
    }

    #[test]
    fn creation_time_is_stamped() {
        let mut command = Command::new("cmd");
        apply_parent_identity(&mut command);
        let stamped = command
            .get_envs()
            .find(|(key, _)| *key == PARENT_CREATED_ENV)
            .and_then(|(_, value)| value)
            .and_then(|value| value.to_str())
            .and_then(|value| value.parse::<u64>().ok());
        assert!(stamped.is_some_and(|value| value > 0));
    }

    #[test]
    fn daemon_runs_in_job_and_dies_when_the_job_closes() {
        let mut command = Command::new("cmd");
        command.args(["/C", "ping -n 30 127.0.0.1 > NUL"]);
        let mut child = spawn_in_kill_on_close_job(&mut command, 0x0800_0000).unwrap();
        {
            let guard = DAEMON_JOB.lock().unwrap();
            assert!(in_job(&child, guard.as_ref().unwrap()));
        }
        assert!(child.try_wait().unwrap().is_none(), "child must be resumed and running");
        let started = Instant::now();
        release_daemon_job();
        child.wait().unwrap();
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
