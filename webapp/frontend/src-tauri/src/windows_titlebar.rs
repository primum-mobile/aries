// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Native Windows titlebar integration for the main Aries window.
//!
//! Keep the real Win32 caption controls and resize frame, but extend the
//! WebView client area through the former titlebar plane. DWM continues to own
//! minimize/maximize/close (including Windows 11 Snap Layout), while React owns
//! only the document title and Aries toolbar actions underneath that plane.
//!
//! DWM draws the caption buttons in the extended frame, under the client area.
//! The WebView's host window covers the whole client area, so it would hide
//! them and take their mouse input (run 41808612146: no buttons visible, the
//! WebView answered HTCLIENT there and a click on minimize did nothing). The
//! host window therefore gets a region with the caption-button rectangle cut
//! out, and the main window paints that rectangle black, which DWM shows as
//! its frame with the real buttons; hit tests there reach this subclass, where
//! `DwmDefWindowProc` answers minimize/maximize/close.

use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};
use std::sync::Mutex;

use crate::window_geometry;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmDefWindowProc, DwmExtendFrameIntoClientArea, DwmGetWindowAttribute, DwmSetWindowAttribute,
    DWMWA_CAPTION_BUTTON_BOUNDS, DWMWA_CAPTION_COLOR,
};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, CombineRgn, CreateRectRgn, DeleteObject, FillRect, GetStockObject,
    InvalidateRect, SetWindowRgn, BLACK_BRUSH, HBRUSH, HDC, RGN_DIFF,
};
use windows::Win32::UI::Controls::MARGINS;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GetClientRect, GetWindowRect, IsIconic, IsZoomed, PostMessageW, SetWindowPos, HTCAPTION, HTCLIENT, HTCLOSE, HTMAXBUTTON, HTMINBUTTON, HTSYSMENU, NCCALCSIZE_PARAMS, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_RESTORE, SM_CXPADDEDBORDER,
    SM_CXSIZE, SM_CYSIZEFRAME, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, WM_DPICHANGED, WM_DWMCOMPOSITIONCHANGED, WM_NCCALCSIZE, WM_NCDESTROY,
    WM_ERASEBKGND, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_SIZE, WM_SYSCOMMAND, WM_THEMECHANGED,
};
use windows::core::{w, PCWSTR};

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

/// The caption button under a screen point, from DWM's measured bounds, when
/// `DwmDefWindowProc` does not answer the hit test itself. A maximized window
/// hangs its resize border off screen, and there DWM still draws minimize,
/// restore and close (on screen, under the cut-out) but no longer claims
/// their hit tests: the rehearsal saw `HTCLIENT` at each of them on Windows
/// Server 2022 and 2025, and a click on restore did nothing.
fn fallback_caption_button_hit(hwnd: HWND, lparam: LPARAM) -> Option<u32> {
    let x = (lparam.0 & 0xFFFF) as u16 as i16 as i32;
    let y = ((lparam.0 >> 16) & 0xFFFF) as u16 as i16 as i32;
    let buttons = caption_buttons_client_rect(hwnd)?;
    let mut origin = POINT { x: 0, y: 0 };
    if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
        return None;
    }
    window_geometry::caption_button_at(
        (
            buttons.left + origin.x,
            buttons.top + origin.y,
            buttons.right + origin.x,
            buttons.bottom + origin.y,
        ),
        x,
        y,
    )
    .map(|index| [HTMINBUTTON, HTMAXBUTTON, HTCLOSE][index])
}

/// What a click on a caption button does when this subclass answered its hit
/// test (see `fallback_caption_button_hit`).
fn caption_button_command(hwnd: HWND, hit: u32) -> Option<u32> {
    match hit {
        HTMINBUTTON => Some(SC_MINIMIZE),
        HTMAXBUTTON if unsafe { IsZoomed(hwnd) }.as_bool() => Some(SC_RESTORE),
        HTMAXBUTTON => Some(SC_MAXIMIZE),
        HTCLOSE => Some(SC_CLOSE),
        _ => None,
    }
}

/// The caption button pressed through the fallback, until its release.
static PRESSED_CAPTION_BUTTON: AtomicU32 = AtomicU32::new(0);

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
            if let Some(hit) = fallback_caption_button_hit(hwnd, lparam) {
                return LRESULT(hit as isize);
            }
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            // Interactive React controls need client input. Empty regions remain
            // draggable through Tauri's native drag-region support.
            clientize_titlebar_hit(result)
        }
        // Clicks on a button whose hit test the fallback answered: act on the
        // release over the same button, as the system buttons do, without
        // DefWindowProc's classic (non-DWM) button tracking.
        WM_NCLBUTTONDOWN if caption_button_command(hwnd, wparam.0 as u32).is_some() => {
            PRESSED_CAPTION_BUTTON.store(wparam.0 as u32, Ordering::SeqCst);
            LRESULT(0)
        }
        WM_NCLBUTTONUP if caption_button_command(hwnd, wparam.0 as u32).is_some() => {
            let pressed = PRESSED_CAPTION_BUTTON.swap(0, Ordering::SeqCst);
            if pressed == wparam.0 as u32 {
                if let Some(command) = caption_button_command(hwnd, pressed) {
                    let _ = unsafe {
                        PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(command as usize), lparam)
                    };
                }
            }
            LRESULT(0)
        }
        WM_DPICHANGED | WM_DWMCOMPOSITIONCHANGED | WM_THEMECHANGED => {
            let _ = extend_frame(hwnd);
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            refresh_caption_cutout(hwnd);
            result
        }
        WM_SIZE => {
            // tao and wry resize the WebView host first; then re-cut its region.
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            refresh_caption_cutout(hwnd);
            result
        }
        WM_ERASEBKGND => {
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            if let Some(cutout) = current_cutout() {
                // Black is transparent in the extended frame: DWM shows its
                // caption buttons there.
                let brush = HBRUSH(unsafe { GetStockObject(BLACK_BRUSH) }.0);
                unsafe { FillRect(HDC(wparam.0 as *mut _), &cutout, brush) };
            }
            result
        }
        WM_NCDESTROY => unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(titlebar_subclass_proc), TITLEBAR_SUBCLASS_ID);
            DefSubclassProc(hwnd, message, wparam, lparam)
        },
        _ => unsafe { DefSubclassProc(hwnd, message, wparam, lparam) },
    }
}

/// Generic estimate used before the window has a measurable frame: the system
/// caption-button metric at 96 DPI times three buttons.
pub fn caption_controls_inset_css_px() -> i32 {
    let button_width = unsafe { GetSystemMetricsForDpi(SM_CXSIZE, DEFAULT_DPI) };
    button_width.max(0) * CAPTION_BUTTON_COUNT
}

/// The caption-button width DWM actually draws for this window, in CSS px.
/// `None` while the window is minimized or DWM reports implausible bounds.
pub fn measured_caption_controls_inset_css_px(hwnd: HWND) -> Option<i32> {
    if unsafe { IsIconic(hwnd) }.as_bool() {
        return None;
    }
    let mut buttons = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_BUTTON_BOUNDS,
            (&mut buttons as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .ok()?;
    // DWM reports the bounds relative to the window rectangle; express the
    // WebView's right edge in that same space.
    let mut window = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut window) }.ok()?;
    let mut client = RECT::default();
    unsafe { GetClientRect(hwnd, &mut client) }.ok()?;
    let mut client_right = POINT {
        x: client.right,
        y: 0,
    };
    if !unsafe { ClientToScreen(hwnd, &mut client_right) }.as_bool() {
        return None;
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    crate::window_geometry::caption_inset_css_px(buttons.left, client_right.x - window.left, dpi)
}

/// The caption-button rectangle cut out of the WebView host, in the main
/// window's client coordinates, with the client size it was cut for.
static CAPTION_CUTOUT: Mutex<Option<(RECT, i32, i32)>> = Mutex::new(None);

fn current_cutout() -> Option<RECT> {
    CAPTION_CUTOUT.lock().ok().and_then(|cutout| cutout.map(|(rect, _, _)| rect))
}

/// Paints DWM's caption (behind the cut-out caption buttons) in the page's
/// background colour, so the buttons sit on the Aries title bar rather than
/// a black or system-coloured block. Windows 11 only; older Windows reject the
/// attribute and keep the system caption colour.
pub fn set_caption_color(hwnd: HWND, red: u8, green: u8, blue: u8) {
    let colorref: u32 = u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16);
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&colorref as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
}

/// Where DWM draws the caption buttons, in client coordinates (physical px).
fn caption_buttons_client_rect(hwnd: HWND) -> Option<RECT> {
    if unsafe { IsIconic(hwnd) }.as_bool() {
        return None;
    }
    let mut buttons = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_BUTTON_BOUNDS,
            (&mut buttons as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .ok()?;
    if buttons.right <= buttons.left || buttons.bottom <= buttons.top {
        return None;
    }
    let mut window = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut window) }.ok()?;
    let mut origin = POINT { x: 0, y: 0 };
    if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
        return None;
    }
    let (dx, dy) = (window.left - origin.x, window.top - origin.y);
    Some(RECT {
        left: buttons.left + dx,
        top: buttons.top + dy,
        right: buttons.right + dx,
        bottom: buttons.bottom + dy,
    })
}

/// Cuts the caption buttons out of the WebView host window (wry's
/// `WRY_WEBVIEW` child, sized to the client area) so DWM's buttons show and
/// take their own clicks. Idempotent; a no-op until the WebView exists.
pub fn refresh_caption_cutout(hwnd: HWND) {
    let Ok(host) = (unsafe { FindWindowExW(Some(hwnd), None, w!("WRY_WEBVIEW"), PCWSTR::null()) }) else {
        return;
    };
    let mut client = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut client) }.is_err() {
        return;
    }
    let cutout = caption_buttons_client_rect(hwnd);
    let next = cutout.map(|rect| (rect, client.right, client.bottom));
    let Ok(mut current) = CAPTION_CUTOUT.lock() else {
        return;
    };
    if *current == next {
        return;
    }
    let previous = current.map(|(rect, _, _)| rect);
    *current = next;
    drop(current);
    unsafe {
        match cutout {
            Some(rect) => {
                let region = CreateRectRgn(0, 0, client.right, client.bottom);
                let hole = CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom);
                let _ = CombineRgn(Some(region), Some(region), Some(hole), RGN_DIFF);
                let _ = DeleteObject(hole.into());
                // The system owns the region once SetWindowRgn succeeds.
                if SetWindowRgn(host, Some(region), true) == 0 {
                    let _ = DeleteObject(region.into());
                }
                let _ = InvalidateRect(Some(hwnd), Some(&rect), true);
            }
            None => {
                let _ = SetWindowRgn(host, None, true);
            }
        }
        if let Some(rect) = previous {
            let _ = InvalidateRect(Some(hwnd), Some(&rect), true);
        }
    }
}

static PUBLISHED_CAPTION_INSET: AtomicI32 = AtomicI32::new(0);

/// Measures the inset and records it; returns `Some` only when it differs from
/// the last published value, so callers emit one event per real change.
pub fn refresh_caption_controls_inset(hwnd: HWND) -> Option<i32> {
    let inset = measured_caption_controls_inset_css_px(hwnd)?;
    (PUBLISHED_CAPTION_INSET.swap(inset, Ordering::SeqCst) != inset).then_some(inset)
}

/// Current inset for a newly mounted page: the measured value when available,
/// else the last published one, else the system-metric estimate.
pub fn current_caption_controls_inset(hwnd: HWND) -> i32 {
    if let Some(inset) = measured_caption_controls_inset_css_px(hwnd) {
        PUBLISHED_CAPTION_INSET.store(inset, Ordering::SeqCst);
        return inset;
    }
    match PUBLISHED_CAPTION_INSET.load(Ordering::SeqCst) {
        0 => caption_controls_inset_css_px(),
        published => published,
    }
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
