# -*- coding: utf-8 -*-
# Shim: old "import ImageFont" -> Pillow's PIL.ImageFont
from PIL.ImageFont import *  # noqa: F401,F403

# Pillow 10+ removed FreeTypeFont.getsize(). Morinus' legacy code uses it
# heavily for layout. Provide a backwards-compatible implementation.
try:
	from PIL import ImageFont as _PILImageFont

	_FreeTypeFont = getattr(_PILImageFont, "FreeTypeFont", None)
	if _FreeTypeFont is not None and not hasattr(_FreeTypeFont, "getsize"):
		def _getsize(self, text, *args, **kwargs):
			# Prefer getbbox() if available (Pillow >= 8).
			if hasattr(self, "getbbox"):
				left, top, right, bottom = self.getbbox(text, *args, **kwargs)
				return (right - left, bottom - top)
			# Fallback: derive from rendered mask.
			mask = self.getmask(text)
			return mask.size

		_FreeTypeFont.getsize = _getsize
except Exception:
	# If anything goes wrong, keep the import shim working.
	pass
