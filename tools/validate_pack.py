#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Command wrapper for the shared corpus pack validator."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from corpus_pack_validation import main, validate_pack_directory  # noqa: E402,F401


if __name__ == '__main__':
    raise SystemExit(main())
