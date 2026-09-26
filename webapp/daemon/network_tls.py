# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Verified HTTPS context for downloads made by the packaged Python daemon."""

from __future__ import annotations

import ssl
import sys
from pathlib import Path


def download_context() -> ssl.SSLContext:
    """Use macOS roots when Python.org's packaged OpenSSL has no CA file."""
    if sys.platform == "darwin" and ssl.get_default_verify_paths().cafile is None:
        system_bundle = Path("/etc/ssl/cert.pem")
        if system_bundle.is_file():
            return ssl.create_default_context(cafile=str(system_bundle))
    return ssl.create_default_context()
