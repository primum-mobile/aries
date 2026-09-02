# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

# Shim: old "import ImageDraw" -> Pillow's PIL.ImageDraw
from PIL.ImageDraw import *  # noqa: F401,F403

# Pillow 10+ removed ImageDraw.textsize(). Morinus' legacy chart layout uses it.
try:
	from PIL import ImageDraw as _PILImageDraw

	_ImageDraw = getattr(_PILImageDraw, "ImageDraw", None)
	if _ImageDraw is not None and not hasattr(_ImageDraw, "textsize"):
		def _textsize(self, text, font=None, *args, **kwargs):
			# Prefer textbbox() when available.
			if hasattr(self, "textbbox"):
				left, top, right, bottom = self.textbbox((0, 0), text, font=font, *args, **kwargs)
				return (right - left, bottom - top)
			# Fallback: use font metrics where possible.
			if font is not None and hasattr(font, "getsize"):
				return font.getsize(text)
			return (0, 0)

		_ImageDraw.textsize = _textsize
except Exception:
	pass
