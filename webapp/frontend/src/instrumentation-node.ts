// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Node-runtime half of instrumentation.ts (dev only).
import { startCopyEditorServer } from "../scripts/copy-editor/server.mjs";

// `next dev` runs from webapp/frontend; the bundled helper cannot locate itself.
startCopyEditorServer({ frontendDir: process.cwd() });
