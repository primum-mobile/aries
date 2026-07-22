// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Native Windows titlebar integration for the main Aries window.
//!
//! Keep the real Win32 caption controls and resize frame, but extend the
//! WebView client area through the former titlebar plane. DWM continues to own
//! minimize/maximize/close (including Windows 11 Snap Layout), while React owns
//! only the document title and Aries toolbar actions underneath that plane.

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmDefWindowProc, DwmExtendFrameIntoClientArea};
use windows::Win32::UI::Controls::MARGINS;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    IsZoomed, SetWindowPos, HTCAPTION, HTCLIENT, HTSYSMENU, NCCALCSIZE_PARAMS, SM_CXPADDEDBORDER,
    SM_CXSIZE, SM_CYSIZEFRAME, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, WM_DPICHANGED, WM_DWMCOMPOSITIONCHANGED, WM_NCCALCSIZE, WM_NCDESTROY,
    WM_NCHITTEST, WM_THEMECHANGED,
};

const TITLEBAR_SUBCLASS_ID: usize = 0x4152_4945;
const TITLEBAR_LOGICAL_HEIGHT: i32 = 34;
const DEFAULT_DPI: u32 = 96;
const CAPTION_BUTTON_COUNT: i32 = 3;

fn physical_titlebar_height(hwnd: HWND) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(DEFAULT_DPI);
    ((TITLEBAR_LOGICAL_HEIGHT as i64 * dpi as i64 + (DEFAULT_DPI as i64 / 2)) / DEFAULT_DPI as i64)
        as i32
}

fn extend_frame(hwnd: HWND) -> windows::core::Result<()> {
    let margins = MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: physical_titlebar_height(hwnd),
        cyBottomHeight: 0,
    };
    unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) }
}

fn maximized_top_inset(hwnd: HWND) -> i32 {
    if !unsafe { IsZoomed(hwnd) }.as_bool() {
        return 0;
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(DEFAULT_DPI);
    unsafe {
        GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
    }
}

fn clientize_titlebar_hit(result: LRESULT) -> LRESULT {
    if result.0 == HTCAPTION as isize || result.0 == HTSYSMENU as isize {
        LRESULT(HTCLIENT as isize)
    } else {
        result
    }
}

unsafe extern "system" fn titlebar_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    let mut dwm_result = LRESULT::default();
    if unsafe { DwmDefWindowProc(hwnd, message, wparam, lparam, &mut dwm_result) }.as_bool() {
        return if message == WM_NCHITTEST {
            clientize_titlebar_hit(dwm_result)
        } else {
            dwm_result
        };
    }

    match message {
        WM_NCCALCSIZE if wparam.0 != 0 => {
            let params = unsafe { &mut *(lparam.0 as *mut NCCALCSIZE_PARAMS) };
            let proposed_top = params.rgrc[0].top;

            // Let Windows retain the side and bottom resize frame, then reclaim
            // only the titlebar's top inset for the WebView client area. A
            // maximized HWND starts above the monitor by its resize-frame width,
            // so preserve that invisible inset instead of clipping the WebView.
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            params.rgrc[0].top = proposed_top + maximized_top_inset(hwnd);
            result
        }
        WM_NCHITTEST => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            // Interactive React controls need client input. Empty regions remain
            // draggable through Tauri's native drag-region support.
            clientize_titlebar_hit(result)
        }
        WM_DPICHANGED | WM_DWMCOMPOSITIONCHANGED | WM_THEMECHANGED => {
            let _ = extend_frame(hwnd);
            unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
        }
        WM_NCDESTROY => unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(titlebar_subclass_proc), TITLEBAR_SUBCLASS_ID);
            DefSubclassProc(hwnd, message, wparam, lparam)
        },
        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

pub fn caption_controls_inset_css_px() -> i32 {
    let button_width = unsafe { GetSystemMetricsForDpi(SM_CXSIZE, DEFAULT_DPI) };
    button_width.max(0) * CAPTION_BUTTON_COUNT
}

pub fn install(hwnd: HWND) -> Result<(), String> {
    let installed =
        unsafe { SetWindowSubclass(hwnd, Some(titlebar_subclass_proc), TITLEBAR_SUBCLASS_ID, 0) };
    if !installed.as_bool() {
        return Err("SetWindowSubclass rejected the native titlebar hook".to_string());
    }

    if let Err(error) = extend_frame(hwnd) {
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(titlebar_subclass_proc), TITLEBAR_SUBCLASS_ID);
        }
        return Err(error.to_string());
    }
    let frame_result = unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    };
    if let Err(error) = frame_result {
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(titlebar_subclass_proc), TITLEBAR_SUBCLASS_ID);
        }
        return Err(error.to_string());
    }
    Ok(())
}
