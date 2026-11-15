// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Display form of a daemon menu accelerator ("CmdOrCtrl+Shift+C") for menus
// rendered in the page. Native menus format accelerators themselves; in-page
// menus use the shared shortcut vocabulary: macOS glyphs in menu order on Apple
// platforms ("⇧⌘C"), localized modifier names elsewhere ("Ctrl+Shift+C").
export { menuAcceleratorLabel } from "@/lib/shortcut-display";
