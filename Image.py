# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

# Image.py shim for Pillow -> old "import Image" style
try:
    from PIL.Image import *
    from PIL import Image as _mod
    __all__ = [n for n in dir(_mod) if not n.startswith('_')]
except ImportError:
    pass
