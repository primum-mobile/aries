// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Platform-free window geometry used by the native shell: fitting a restored
//! frame onto the monitors that exist now, and turning a measured caption
//! button area into a CSS inset. Kept pure so it is unit-tested on every host.

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// An axis-aligned rectangle in one coordinate space (physical pixels for
/// monitor work areas and outer window frames).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }

    fn contains(&self, other: &Rect) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }

    fn overlap_area(&self, other: &Rect) -> f64 {
        let width = self.right().min(other.right()) - self.x.max(other.x);
        let height = self.bottom().min(other.bottom()) - self.y.max(other.y);
        if width > 0.0 && height > 0.0 {
            width * height
        } else {
            0.0
        }
    }

    fn distance_squared_to_point(&self, x: f64, y: f64) -> f64 {
        let dx = (self.x - x).max(0.0).max(x - self.right());
        let dy = (self.y - y).max(0.0).max(y - self.bottom());
        dx * dx + dy * dy
    }
}

/// A frame fitted to one monitor work area: `area` indexes the input list.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FittedFrame {
    pub frame: Rect,
    pub area: usize,
}

/// Fits a saved window frame onto the work areas available now.
///
/// A frame wholly inside one work area is kept as is. Otherwise (a monitor was
/// unplugged, the laptop undocked, or the frame is larger than the screen) the
/// frame moves onto the work area it overlaps most, or the nearest one when it
/// overlaps none, shrinking only as much as that area requires. Returns `None`
/// when there is no usable work area, so callers leave the frame untouched.
pub(crate) fn fit_frame_to_work_areas(frame: Rect, areas: &[Rect]) -> Option<FittedFrame> {
    if !frame.is_valid() {
        return None;
    }
    let usable = || areas.iter().enumerate().filter(|(_, area)| area.is_valid());
    if let Some((index, _)) = usable().find(|(_, area)| area.contains(&frame)) {
        return Some(FittedFrame { frame, area: index });
    }
    let (best_index, best_overlap) = usable()
        .map(|(index, area)| (index, area.overlap_area(&frame)))
        .fold(None, |best: Option<(usize, f64)>, candidate| match best {
            Some(current) if current.1 >= candidate.1 => Some(current),
            _ => Some(candidate),
        })?;
    let index = if best_overlap > 0.0 {
        best_index
    } else {
        let center_x = frame.x + frame.width / 2.0;
        let center_y = frame.y + frame.height / 2.0;
        usable()
            .map(|(index, area)| (index, area.distance_squared_to_point(center_x, center_y)))
            .fold(None, |best: Option<(usize, f64)>, candidate| match best {
                Some(current) if current.1 <= candidate.1 => Some(current),
                _ => Some(candidate),
            })?
            .0
    };
    let area = areas[index];
    let width = frame.width.min(area.width);
    let height = frame.height.min(area.height);
    Some(FittedFrame {
        frame: Rect {
            x: frame.x.clamp(area.x, area.right() - width),
            y: frame.y.clamp(area.y, area.bottom() - height),
            width,
            height,
        },
        area: index,
    })
}

/// The minimum window size that still fits a work area of the given logical
/// size. A 1080p laptop at 150 % offers about 1280 × 690 logical pixels, which
/// is below the main window's design minimum height; without this the window
/// would extend past the taskbar even when maximized.
pub(crate) fn min_size_within(
    min_width: f64,
    min_height: f64,
    area_width: f64,
    area_height: f64,
) -> (f64, f64) {
    let fit = |minimum: f64, available: f64| {
        if available.is_finite() && available > 0.0 {
            minimum.min(available.floor())
        } else {
            minimum
        }
    };
    (fit(min_width, area_width), fit(min_height, area_height))
}

/// Smallest and largest plausible caption-control insets, in CSS pixels. Three
/// Windows 11 caption buttons are 138 CSS px wide; a value outside this range
/// means DWM reported bounds for a hidden, minimized or unthemed frame.
const MIN_CAPTION_INSET_CSS_PX: i32 = 60;
const MAX_CAPTION_INSET_CSS_PX: i32 = 320;

/// Converts the measured caption-button area into the CSS width the React
/// titlebar must leave free at its trailing edge.
///
/// `buttons_left_px` is the left edge of `DWMWA_CAPTION_BUTTON_BOUNDS` and
/// `client_right_px` the right edge of the WebView client area, both in
/// physical pixels relative to the window rectangle. The result is rounded up
/// so React never overlaps the minimize button.
pub(crate) fn caption_inset_css_px(buttons_left_px: i32, client_right_px: i32, dpi: u32) -> Option<i32> {
    let physical = i64::from(client_right_px) - i64::from(buttons_left_px);
    if physical <= 0 {
        return None;
    }
    let dpi = i64::from(if dpi == 0 { 96 } else { dpi });
    let css = (physical * 96 + dpi - 1) / dpi;
    let css = i32::try_from(css).ok()?;
    (MIN_CAPTION_INSET_CSS_PX..=MAX_CAPTION_INSET_CSS_PX)
        .contains(&css)
        .then_some(css)
}

/// Which of the three caption buttons (0 minimize, 1 maximize/restore,
/// 2 close) is under a point, given their combined rectangle
/// `(left, top, right, bottom)` in the same pixel space as the point. Right
/// and bottom edges are exclusive, as in Win32 rectangles.
pub(crate) fn caption_button_at(buttons: (i32, i32, i32, i32), x: i32, y: i32) -> Option<usize> {
    let (left, top, right, bottom) = buttons;
    if right <= left || bottom <= top || x < left || x >= right || y < top || y >= bottom {
        return None;
    }
    let index = (i64::from(x - left) * 3) / i64::from(right - left);
    Some(index.clamp(0, 2) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caption_button_at_splits_the_bounds_in_thirds() {
        // DWM's bounds on a maximized 1920 px window (run 41826122428).
        let buttons = (1773, -8, 1919, 22);
        assert_eq!(caption_button_at(buttons, 1773, 0), Some(0));
        assert_eq!(caption_button_at(buttons, 1797, 7), Some(0));
        assert_eq!(caption_button_at(buttons, 1846, 7), Some(1));
        assert_eq!(caption_button_at(buttons, 1894, 7), Some(2));
        assert_eq!(caption_button_at(buttons, 1918, 21), Some(2));
        assert_eq!(caption_button_at(buttons, 1919, 7), None);
        assert_eq!(caption_button_at(buttons, 1772, 7), None);
        assert_eq!(caption_button_at(buttons, 1846, 22), None);
        assert_eq!(caption_button_at((10, 0, 10, 30), 10, 5), None);
    }

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn frame_inside_a_work_area_is_kept() {
        let areas = [rect(0.0, 0.0, 1920.0, 1040.0), rect(1920.0, 0.0, 2560.0, 1400.0)];
        let frame = rect(2000.0, 100.0, 1280.0, 860.0);
        assert_eq!(
            fit_frame_to_work_areas(frame, &areas),
            Some(FittedFrame { frame, area: 1 })
        );
    }

    #[test]
    fn frame_on_an_unplugged_monitor_moves_to_the_nearest_one() {
        // Saved on a monitor right of the laptop; only the laptop remains.
        let areas = [rect(0.0, 0.0, 1920.0, 1032.0)];
        let fitted = fit_frame_to_work_areas(rect(2400.0, 200.0, 1280.0, 860.0), &areas).unwrap();
        assert_eq!(fitted.area, 0);
        assert_eq!(fitted.frame, rect(640.0, 172.0, 1280.0, 860.0));
    }

    #[test]
    fn frame_on_a_monitor_left_of_the_primary_uses_negative_coordinates() {
        let areas = [rect(0.0, 0.0, 1920.0, 1040.0), rect(-1600.0, 0.0, 1600.0, 860.0)];
        let fitted = fit_frame_to_work_areas(rect(-1700.0, 20.0, 1280.0, 860.0), &areas).unwrap();
        assert_eq!(fitted.area, 1);
        assert_eq!(fitted.frame, rect(-1600.0, 0.0, 1280.0, 860.0));
    }

    #[test]
    fn oversized_frame_shrinks_to_the_work_area() {
        let areas = [rect(0.0, 0.0, 1366.0, 728.0)];
        let fitted = fit_frame_to_work_areas(rect(-10.0, -10.0, 2560.0, 1440.0), &areas).unwrap();
        assert_eq!(fitted.frame, rect(0.0, 0.0, 1366.0, 728.0));
    }

    #[test]
    fn straddling_frame_settles_on_the_monitor_it_overlaps_most() {
        let areas = [rect(0.0, 0.0, 1920.0, 1040.0), rect(1920.0, 0.0, 1920.0, 1040.0)];
        let fitted = fit_frame_to_work_areas(rect(1800.0, 100.0, 1280.0, 860.0), &areas).unwrap();
        assert_eq!(fitted.area, 1);
        assert_eq!(fitted.frame, rect(1920.0, 100.0, 1280.0, 860.0));
    }

    #[test]
    fn titlebar_above_the_work_area_is_pulled_back_down() {
        let areas = [rect(0.0, 0.0, 1920.0, 1040.0)];
        let fitted = fit_frame_to_work_areas(rect(200.0, -300.0, 1280.0, 860.0), &areas).unwrap();
        assert_eq!(fitted.frame, rect(200.0, 0.0, 1280.0, 860.0));
    }

    #[test]
    fn missing_or_invalid_geometry_leaves_the_frame_alone() {
        let frame = rect(0.0, 0.0, 1280.0, 860.0);
        assert_eq!(fit_frame_to_work_areas(frame, &[]), None);
        assert_eq!(fit_frame_to_work_areas(frame, &[rect(0.0, 0.0, 0.0, 0.0)]), None);
        assert_eq!(
            fit_frame_to_work_areas(rect(f64::NAN, 0.0, 1280.0, 860.0), &[rect(0.0, 0.0, 1920.0, 1040.0)]),
            None
        );
    }

    #[test]
    fn minimum_size_never_exceeds_a_small_work_area() {
        assert_eq!(min_size_within(1024.0, 720.0, 1280.0, 688.5), (1024.0, 688.0));
        assert_eq!(min_size_within(1024.0, 720.0, 2560.0, 1400.0), (1024.0, 720.0));
        assert_eq!(min_size_within(1024.0, 720.0, f64::NAN, 0.0), (1024.0, 720.0));
    }

    #[test]
    fn caption_inset_follows_measured_buttons_and_dpi() {
        // Windows 11 at 100 %: three 46 px buttons end at the client edge.
        assert_eq!(caption_inset_css_px(1142, 1280, 96), Some(138));
        // 150 %: 207 physical px is 138 CSS px.
        assert_eq!(caption_inset_css_px(1713, 1920, 144), Some(138));
        // 125 %: 173 physical px rounds up to 139 CSS px, never under-reserving.
        assert_eq!(caption_inset_css_px(1427, 1600, 120), Some(139));
        // A zero DPI is treated as 96.
        assert_eq!(caption_inset_css_px(1142, 1280, 0), Some(138));
    }

    #[test]
    fn implausible_caption_bounds_fall_back() {
        assert_eq!(caption_inset_css_px(1280, 1280, 96), None);
        assert_eq!(caption_inset_css_px(1300, 1280, 96), None);
        assert_eq!(caption_inset_css_px(1260, 1280, 96), None);
        assert_eq!(caption_inset_css_px(0, 1280, 96), None);
    }
}
