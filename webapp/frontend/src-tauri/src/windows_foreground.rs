// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Bringing the running Aries window to the front for a second launch
//! (Windows only).
//!
//! Windows' foreground lock lets only the foreground process (or one it
//! named) take the foreground; otherwise `SetForegroundWindow` just flashes
//! the taskbar button. The single-instance plugin's second process already
//! calls `AllowSetForegroundWindow(<this pid>)` before it forwards its
//! arguments, which covers a launch from Explorer, Start or the taskbar. A
//! launch from a background process has no right to hand over, so this falls
//! back to the standard techniques, in order: attach to the foreground
//! thread's input queue, then a synthetic Alt tap (which lifts the lock).

use std::mem::size_of;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// Restores `hwnd` if minimized and makes it the foreground window. Returns
/// whether it is in front afterwards.
pub(crate) fn bring_to_front(hwnd: HWND) -> bool {
    // SAFETY: plain user32 calls on a window handle owned by this process;
    // a stale handle only makes them fail.
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if GetForegroundWindow() == hwnd {
            return true;
        }
        if SetForegroundWindow(hwnd).as_bool() && GetForegroundWindow() == hwnd {
            return true;
        }

        // Share the foreground thread's input state for the call.
        let foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let this_thread = GetCurrentThreadId();
        let attached = foreground_thread != 0
            && foreground_thread != this_thread
            && AttachThreadInput(this_thread, foreground_thread, true).as_bool();
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        if attached {
            let _ = AttachThreadInput(this_thread, foreground_thread, false);
        }
        if GetForegroundWindow() == hwnd {
            return true;
        }

        // A synthetic Alt press and release counts as input to this process.
        let alt = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_MENU,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        let inputs = [alt(Default::default()), alt(KEYEVENTF_KEYUP)];
        SendInput(&inputs, size_of::<INPUT>() as i32);
        let _ = SetForegroundWindow(hwnd);
        GetForegroundWindow() == hwnd
    }
}
