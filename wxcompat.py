# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""
wxPython compatibility helpers.

Morinus' rendering code frequently uses float coordinates/radii. wxPython on
macOS is strict and expects ints for many wx.DC drawing APIs. This module wraps
wx.DC-like objects and coerces common drawing arguments to ints.
"""

import wx
import os
import sys
import time
import tempfile
import struct
from functools import lru_cache


_MEASURE_DC = None
_MEASURE_BMP = None
MORINUS_BUNDLED_FACE = 'Morinus Aries Bundled'
_RENAMED_FONT_CACHE = {}

def get_dpi_scale(window=None):
	"""Return the display scale factor (e.g. 2.0 on Retina). Degrades to 1.0."""
	try:
		if window is not None:
			return window.GetContentScaleFactor()
	except Exception:
		pass
	try:
		return wx.GetApp().GetTopWindow().GetContentScaleFactor()
	except Exception:
		pass
	return 1.0


def create_scaled_bitmap(logical_w, logical_h, scale):
	"""Create a bitmap at physical resolution with correct logical-size metadata.

	On Retina (scale=2.0), a 600x600 logical bitmap becomes 1200x1200 physical
	pixels. SetScaleFactor tells wxPython the logical size so paint handlers
	draw it correctly without any changes.
	"""
	pw = max(1, int(logical_w * scale))
	ph = max(1, int(logical_h * scale))
	bmp = wx.Bitmap(pw, ph)
	if hasattr(bmp, 'SetScaleFactor'):
		bmp.SetScaleFactor(scale)
	return bmp


def set_bitmap_scale(bmp, scale):
	"""Apply scale factor metadata to an existing bitmap."""
	if scale != 1.0 and hasattr(bmp, 'SetScaleFactor'):
		bmp.SetScaleFactor(scale)
	return bmp


# Legacy chart rendering is handled natively by CompatDC(antialias=False)
# — the chart renderers (graphchart.py, mundanechart.py, squarechart.py,
# astrolabechart.py, graphephemwnd.py, graphchartpds.py) pass that flag
# when `options.legacypixelated` is on. No bitmap post-processing here.


def _to_colour(fill):
	if fill is None:
		return wx.BLACK
	if isinstance(fill, wx.Colour):
		return fill
	try:
		return wx.Colour(int(fill[0]), int(fill[1]), int(fill[2]))
	except Exception:
		return wx.BLACK


def _ensure_measure_dc():
	global _MEASURE_DC, _MEASURE_BMP
	if _MEASURE_DC is None:
		_MEASURE_BMP = wx.Bitmap(1, 1)
		_MEASURE_DC = wx.MemoryDC()
		_MEASURE_DC.SelectObject(_MEASURE_BMP)
	return _MEASURE_DC


def measure_text_extent(wxfont, text):
	"""Measure text with a process-owned MemoryDC, never an event PaintDC."""
	dc = _ensure_measure_dc()
	dc.SetFont(wxfont)
	return dc.GetTextExtent(str(text))


def register_private_font(path, family_name=None):
	"""Register a private font file with wx if the runtime supports it."""
	if not path:
		return False
	try:
		if sys.platform == 'darwin':
			if family_name:
				renamed = _RENAMED_FONT_CACHE.get((path, family_name))
				if renamed is None:
					renamed = _make_renamed_font_copy(path, family_name)
					_RENAMED_FONT_CACHE[(path, family_name)] = renamed
				if renamed:
					path = renamed
			import ctypes
			corefoundation = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
			coretext = ctypes.CDLL('/System/Library/Frameworks/CoreText.framework/CoreText')

			kCTFontManagerScopeProcess = 1

			corefoundation.CFURLCreateFromFileSystemRepresentation.restype = ctypes.c_void_p
			corefoundation.CFURLCreateFromFileSystemRepresentation.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_bool]
			coretext.CTFontManagerRegisterFontsForURL.restype = ctypes.c_bool
			coretext.CTFontManagerRegisterFontsForURL.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]

			font_path = os.fsencode(os.path.abspath(path))
			url = corefoundation.CFURLCreateFromFileSystemRepresentation(None, font_path, len(font_path), False)
			if not url:
				return False
			return bool(coretext.CTFontManagerRegisterFontsForURL(url, kCTFontManagerScopeProcess, None))
		if hasattr(wx.Font, 'AddPrivateFont'):
			return bool(wx.Font.AddPrivateFont(path))
		return False
	except Exception:
		return False


def _make_renamed_font_copy(path, family_name):
	try:
		from fontTools.ttLib import TTFont
	except Exception:
		return _make_renamed_font_copy_without_fonttools(path, family_name)
	try:
		font = TTFont(path)
	except Exception:
		return _make_renamed_font_copy_without_fonttools(path, family_name)
	try:
		family = str(family_name)
		subfamily = 'Regular'
		full_name = '%s %s' % (family, subfamily)
		postscript = family.replace(' ', '') + '-Regular'
		for record in font['name'].names:
			if record.nameID in (1, 16):
				record.string = family.encode(record.getEncoding(), errors='ignore')
			elif record.nameID in (2, 17):
				record.string = subfamily.encode(record.getEncoding(), errors='ignore')
			elif record.nameID in (4, 18):
				record.string = full_name.encode(record.getEncoding(), errors='ignore')
			elif record.nameID == 6:
				record.string = postscript.encode(record.getEncoding(), errors='ignore')
		cache_dir = os.path.join(tempfile.gettempdir(), 'morinus-font-cache')
		if not os.path.isdir(cache_dir):
			os.makedirs(cache_dir)
		safe_family = ''.join(ch for ch in family if ch.isalnum()) or 'MorinusAriesBundled'
		out_path = os.path.join(cache_dir, '%s.ttf' % safe_family)
		font.save(out_path)
		return out_path
	except Exception:
		return _make_renamed_font_copy_without_fonttools(path, family_name)


def _make_renamed_font_copy_without_fonttools(path, family_name):
	try:
		with open(path, 'rb') as handle:
			font_data = bytearray(handle.read())
	except Exception:
		return None

	try:
		name_entry = _find_sfnt_table(font_data, b'name')
		head_entry = _find_sfnt_table(font_data, b'head')
		if name_entry is None or head_entry is None:
			return None

		name_offset, name_length, _ = name_entry
		format_sel, count, string_offset = struct.unpack('>HHH', font_data[name_offset:name_offset+6])
		if format_sel != 0:
			return None

		records = []
		cursor = name_offset + 6
		for _ in range(count):
			record = struct.unpack('>HHHHHH', font_data[cursor:cursor+12])
			records.append(record)
			cursor += 12

		subfamily = _extract_name_record_text(font_data, name_offset, string_offset, records, 2) or 'Regular'
		full_name = '%s %s' % (family_name, subfamily)
		postscript = ('%s-%s' % (family_name.replace(' ', ''), subfamily.replace(' ', ''))) or 'MorinusAriesBundled-Regular'

		replacement_by_name_id = {
			1: str(family_name),
			4: full_name,
			6: postscript,
			16: str(family_name),
			18: full_name,
		}

		storage = bytearray()
		new_records = []
		for platform_id, encoding_id, language_id, name_id, _, _ in records:
			text = replacement_by_name_id.get(name_id)
			if text is None:
				text = _decode_name_record_text(font_data, name_offset, string_offset, platform_id, encoding_id, language_id, name_id, records)
			encoded = _encode_name_record_text(text, platform_id, encoding_id)
			record_offset = len(storage)
			storage.extend(encoded)
			new_records.append((platform_id, encoding_id, language_id, name_id, len(encoded), record_offset))

		new_name_table = bytearray(struct.pack('>HHH', 0, len(new_records), 6 + len(new_records) * 12))
		for record in new_records:
			new_name_table.extend(struct.pack('>HHHHHH', *record))
		new_name_table.extend(storage)

		new_font_data = _replace_sfnt_table(font_data, b'name', new_name_table)
		if new_font_data is None:
			return None
		_fix_sfnt_checksum(new_font_data, head_entry[0])

		cache_dir = os.path.join(tempfile.gettempdir(), 'morinus-font-cache')
		if not os.path.isdir(cache_dir):
			os.makedirs(cache_dir)
		safe_family = ''.join(ch for ch in str(family_name) if ch.isalnum()) or 'MorinusAriesBundled'
		out_path = os.path.join(cache_dir, '%s.ttf' % safe_family)
		with open(out_path, 'wb') as handle:
			handle.write(new_font_data)
		return out_path
	except Exception:
		return None


def _find_sfnt_table(font_data, tag):
	try:
		num_tables = struct.unpack('>H', font_data[4:6])[0]
		directory_offset = 12
		for index in range(num_tables):
			entry_offset = directory_offset + index * 16
			entry_tag, checksum, offset, length = struct.unpack('>4sIII', font_data[entry_offset:entry_offset+16])
			if entry_tag == tag:
				return (offset, length, entry_offset)
	except Exception:
		return None
	return None


def _extract_name_record_text(font_data, table_offset, string_offset, records, target_name_id):
	for platform_id, encoding_id, language_id, name_id, length, offset in records:
		if name_id != target_name_id:
			continue
		text = _decode_name_record_text(font_data, table_offset, string_offset, platform_id, encoding_id, language_id, name_id, records)
		if text:
			return text
	return ''


def _decode_name_record_text(font_data, table_offset, string_offset, platform_id, encoding_id, language_id, name_id, records):
	for record_platform_id, record_encoding_id, record_language_id, record_name_id, length, offset in records:
		if (record_platform_id, record_encoding_id, record_language_id, record_name_id) != (platform_id, encoding_id, language_id, name_id):
			continue
		start = table_offset + string_offset + offset
		end = start + length
		raw = bytes(font_data[start:end])
		if platform_id in (0, 3):
			try:
				return raw.decode('utf-16-be')
			except Exception:
				return raw.decode('latin-1', errors='ignore')
		try:
			return raw.decode('mac_roman')
		except Exception:
			return raw.decode('latin-1', errors='ignore')
	return ''


def _encode_name_record_text(text, platform_id, encoding_id):
	value = str(text or '')
	if platform_id in (0, 3):
		return value.encode('utf-16-be')
	try:
		return value.encode('mac_roman', errors='ignore')
	except Exception:
		return value.encode('latin-1', errors='ignore')


def _replace_sfnt_table(font_data, tag, new_table_bytes):
	entry = _find_sfnt_table(font_data, tag)
	if entry is None:
		return None
	_, _, entry_offset = entry
	new_font_data = bytearray(font_data)
	new_offset = (len(new_font_data) + 3) & ~3
	if new_offset > len(new_font_data):
		new_font_data.extend(b'\0' * (new_offset - len(new_font_data)))
	new_font_data.extend(new_table_bytes)
	padding = (-len(new_table_bytes)) % 4
	if padding:
		new_font_data.extend(b'\0' * padding)
	checksum = _sfnt_checksum(new_table_bytes)
	new_font_data[entry_offset:entry_offset+16] = struct.pack('>4sIII', tag, checksum, new_offset, len(new_table_bytes))
	return new_font_data


def _sfnt_checksum(table_bytes):
	data = bytes(table_bytes)
	padding = (-len(data)) % 4
	if padding:
		data += b'\0' * padding
	checksum = 0
	for index in range(0, len(data), 4):
		checksum = (checksum + struct.unpack('>I', data[index:index+4])[0]) & 0xFFFFFFFF
	return checksum


def _fix_sfnt_checksum(font_data, original_head_offset):
	head_entry = _find_sfnt_table(font_data, b'head')
	if head_entry is None:
		return
	head_offset = head_entry[0]
	font_data[head_offset+8:head_offset+12] = b'\0\0\0\0'
	checksum = _sfnt_checksum(font_data)
	adjustment = (0xB1B0AFBA - checksum) & 0xFFFFFFFF
	font_data[head_offset+8:head_offset+12] = struct.pack('>I', adjustment)


def _i(v):
	if v is None:
		return 0
	if isinstance(v, bool):
		return int(v)
	try:
		return int(round(v))
	except Exception:
		return int(v)


def _pt(p):
	try:
		return (_i(p.x), _i(p.y))
	except Exception:
		try:
			return (_i(p[0]), _i(p[1]))
		except Exception:
			return (_i(p), 0)


def _rect_dim(rect, name):
	for attr in (name, name.lower()):
		if hasattr(rect, attr):
			return _i(getattr(rect, attr))
	getter = "Get" + name
	if hasattr(rect, getter):
		return _i(getattr(rect, getter)())
	return 0


def display_client_size(window=None):
	display_index = wx.NOT_FOUND
	try:
		if window is not None:
			display_index = wx.Display.GetFromWindow(window)
	except Exception:
		display_index = wx.NOT_FOUND

	if display_index == wx.NOT_FOUND:
		try:
			if wx.Display.GetCount() > 0:
				display_index = 0
		except Exception:
			display_index = wx.NOT_FOUND

	if display_index != wx.NOT_FOUND:
		try:
			rect = wx.Display(display_index).GetClientArea()
			width = max(1, _rect_dim(rect, "Width"))
			height = max(1, _rect_dim(rect, "Height"))
			return width, height
		except Exception:
			pass

	return (1440, 900)


def scaled_window_size(window, height_ratio, default_size, min_size=(200, 200), width_cap_ratio=0.95, square=False):
	default_width, default_height = default_size
	min_width, min_height = min_size
	screen_width, screen_height = display_client_size(window)

	target_height = max(min_height, _i(screen_height * height_ratio))
	if square:
		target_width = max(min_width, target_height)
	else:
		aspect = float(default_width) / float(default_height or 1)
		target_width = max(min_width, _i(target_height * aspect))

	width_cap = max(min_width, _i(screen_width * width_cap_ratio))
	if target_width > width_cap:
		target_width = width_cap
		if square:
			target_height = max(min_height, target_width)
		else:
			target_height = max(min_height, _i(target_width / aspect))

	return target_width, target_height


def apply_frame_screen_size(frame, height_ratio, default_size, min_size=(200, 200), width_cap_ratio=0.95, square=False):
	width, height = scaled_window_size(frame, height_ratio, default_size, min_size, width_cap_ratio, square)
	frame.SetMinSize(min_size)
	frame.SetSize((width, height))
	try:
		frame.CentreOnScreen()
	except Exception:
		try:
			frame.CenterOnScreen()
		except Exception:
			pass


def place_dialog_left_of_parent(dialog, parent, gap=12):
	if dialog is None or parent is None:
		return

	try:
		parent_pos = parent.GetScreenPosition()
		parent_size = parent.GetSize()
		dialog_size = dialog.GetSize()
	except Exception:
		return

	try:
		screen_width, screen_height = display_client_size(parent)
	except Exception:
		screen_width, screen_height = (1440, 900)

	x = parent_pos.x - dialog_size.width - gap
	y = parent_pos.y + max(0, (parent_size.height - dialog_size.height) // 2)

	if x < 0:
		x = gap
	if y < 0:
		y = gap
	if x + dialog_size.width > screen_width:
		x = max(gap, screen_width - dialog_size.width - gap)
	if y + dialog_size.height > screen_height:
		y = max(gap, screen_height - dialog_size.height - gap)

	try:
		dialog.SetPosition((x, y))
	except Exception:
		pass


class ScaledFont:
	"""Wraps a PIL font so getsize/getbbox/getlength return logical units
	while the underlying font renders at physical (scaled) resolution."""

	def __init__(self, font, scale):
		self._font = font
		self._s = scale

	def __getattr__(self, name):
		return getattr(self._font, name)

	def getsize(self, text, *args, **kw):
		w, h = self._font.getsize(text, *args, **kw)
		s = self._s
		return (w / s, h / s)

	def getbbox(self, text, *args, **kw):
		bbox = self._font.getbbox(text, *args, **kw)
		s = self._s
		return (bbox[0] / s, bbox[1] / s, bbox[2] / s, bbox[3] / s)

	def getlength(self, text, *args, **kw):
		return self._font.getlength(text, *args, **kw) / self._s


class ScaledPILDraw:
	"""Wraps PIL ImageDraw so callers can use logical coordinates while the
	underlying image is at physical (scaled) resolution.  text() coords are
	multiplied by *scale*; textsize() results are divided by *scale* so that
	layout math stays in logical units."""

	def __init__(self, draw, scale, tracking=0):
		self._draw = draw
		self._s = scale
		self._tracking = tracking

	def __getattr__(self, name):
		return getattr(self._draw, name)

	def _unwrap_font(self, font):
		return getattr(font, '_font', font)

	def text(self, xy, text, fill=None, **kw):
		s = self._s
		t = self._tracking
		if fill is not None:
			kw['fill'] = fill
		font = kw.get('font')
		raw_font = self._unwrap_font(font) if font else None
		if t and len(text) > 1 and raw_font:
			kw['font'] = raw_font
			x, y = xy[0], xy[1]
			for ch in text:
				self._draw.text((x * s, y * s), ch, **kw)
				cw = raw_font.getlength(ch) if hasattr(raw_font, 'getlength') else self._draw.textsize(ch, font=raw_font)[0]
				x += cw / s + t
		else:
			sx, sy = xy[0] * s, xy[1] * s
			if font:
				kw['font'] = raw_font
			self._draw.text((sx, sy), text, **kw)

	def textsize(self, text, font=None, *args, **kw):
		w, h = self._draw.textsize(text, font=self._unwrap_font(font), *args, **kw)
		s = self._s
		t = self._tracking
		if t and len(text) > 1:
			w_tracked = w / s + t * (len(text) - 1)
			return (w_tracked, h / s)
		return (w / s, h / s)

	def textbbox(self, xy, text, font=None, *args, **kw):
		s = self._s
		sx, sy = xy[0] * s, xy[1] * s
		left, top, right, bottom = self._draw.textbbox((sx, sy), text, font=self._unwrap_font(font), *args, **kw)
		return (left / s, top / s, right / s, bottom / s)

	def line(self, xy, **kw):
		s = self._s
		if 'width' in kw:
			kw['width'] = max(1, int(round(kw['width'] * s)))
		if xy and isinstance(xy[0], (int, float)):
			scaled = [v * s for v in xy]
		else:
			scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.line(scaled, **kw)

	def rectangle(self, xy, **kw):
		s = self._s
		if 'width' in kw:
			kw['width'] = max(1, int(round(kw['width'] * s)))
		if xy and isinstance(xy[0], (int, float)):
			scaled = [v * s for v in xy]
		else:
			scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.rectangle(scaled, **kw)

	def ellipse(self, xy, **kw):
		s = self._s
		if xy and isinstance(xy[0], (int, float)):
			scaled = [v * s for v in xy]
		else:
			scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.ellipse(scaled, **kw)

	def polygon(self, xy, **kw):
		s = self._s
		scaled = [(x * s, y * s) for x, y in xy]
		return self._draw.polygon(scaled, **kw)


class VectorFont:
	"""wx font wrapper with cached logical text measurement."""

	def __init__(self, face_name, pixel_size, family=wx.FONTFAMILY_DEFAULT, style=wx.FONTSTYLE_NORMAL, weight=wx.FONTWEIGHT_NORMAL):
		self.face_name = face_name or ''
		self.pixel_size = max(1, int(round(pixel_size)))
		self.family = family
		self.style = style
		self.weight = weight
		scale = get_dpi_scale()
		point_size = max(1, int(round(self.pixel_size / max(scale, 1.0))))
		font = wx.Font(point_size, family, style, weight)
		if self.face_name:
			try:
				font.SetFaceName(self.face_name)
			except Exception:
				pass
		self.wxfont = font
		self._measure_calls = 0
		self._measure_chars = 0
		self._measure_ns = 0

	def __getattr__(self, name):
		return getattr(self.wxfont, name)

	def _measure(self, text):
		start = time.perf_counter_ns()
		dc = _ensure_measure_dc()
		dc.SetFont(self.wxfont)
		try:
			result = dc.GetTextExtent(text)
		except Exception:
			result = (0, 0)
		end = time.perf_counter_ns()
		self._measure_calls += 1
		self._measure_chars += len(text or '')
		self._measure_ns += (end - start)
		return result

	@lru_cache(maxsize=4096)
	def _cached_measure(self, text):
		return self._measure(text)

	def getsize(self, text, *args, **kwargs):
		if not text:
			return (0, 0)
		return self._cached_measure(str(text))

	def getbbox(self, text, *args, **kwargs):
		w, h = self.getsize(text)
		return (0, 0, w, h)

	def getlength(self, text, *args, **kwargs):
		return self.getsize(text)[0]

	def profile_snapshot(self):
		return {
			'measure_calls': self._measure_calls,
			'measure_chars': self._measure_chars,
			'measure_ms': self._measure_ns / 1_000_000.0,
		}


class VectorTextDraw:
	"""wx.GraphicsContext-backed text helper with a Pillow-like API.

	``text_antialias_override`` forces a specific antialias mode around each
	``DrawText`` call and restores the gc's previous mode afterwards. Used
	by the chart renderers in legacy-aesthetic mode (where the gc has AA
	disabled globally for crisp strokes) to keep glyphs rendering smooth —
	matches pre-fork Morinus on Wine, where Windows GDI text uses its own
	antialiased font subsystem regardless of shape-stroke AA settings.
	Pass ``wx.ANTIALIAS_DEFAULT`` to force smooth text; pass ``None`` (the
	default) to leave the gc's current AA mode untouched.
	"""

	def __init__(self, gc, scale=1.0, text_antialias_override=None):
		self._gc = gc
		self._s = scale
		self._text_aa_override = text_antialias_override
		self._text_calls = 0
		self._text_chars = 0
		self._text_ns = 0

	def __getattr__(self, name):
		return getattr(self._gc, name)

	def _set_font(self, font, fill=None):
		wxfont = getattr(font, 'wxfont', font)
		self._gc.SetFont(wxfont, _to_colour(fill))

	def text(self, xy, text, font=None, fill=None):
		if font is None:
			return
		x, y = xy
		self._set_font(font, fill)
		prev_aa = None
		if self._text_aa_override is not None:
			try:
				prev_aa = self._gc.GetAntialiasMode()
				self._gc.SetAntialiasMode(self._text_aa_override)
			except Exception:
				prev_aa = None
		start = time.perf_counter_ns()
		result = self._gc.DrawText(str(text), _i(x), _i(y))
		end = time.perf_counter_ns()
		if prev_aa is not None:
			try:
				self._gc.SetAntialiasMode(prev_aa)
			except Exception:
				pass
		self._text_calls += 1
		self._text_chars += len(str(text))
		self._text_ns += (end - start)
		return result

	def textsize(self, text, font=None, *args, **kwargs):
		if font is None:
			return (0, 0)
		return font.getsize(text)

	def textbbox(self, xy, text, font=None, *args, **kwargs):
		w, h = self.textsize(text, font)
		x, y = xy
		return (_i(x), _i(y), _i(x) + w, _i(y) + h)

	def line(self, xy, **kw):
		if hasattr(self._gc, 'StrokeLine'):
			if xy and isinstance(xy[0], (int, float)):
				x1, y1, x2, y2 = xy
			else:
				(x1, y1), (x2, y2) = xy
			return self._gc.StrokeLine(_i(x1), _i(y1), _i(x2), _i(y2))
		return None

	def rectangle(self, xy, **kw):
		if hasattr(self._gc, 'DrawRectangle'):
			if xy and isinstance(xy[0], (int, float)):
				x1, y1, x2, y2 = xy
				return self._gc.DrawRectangle(_i(x1), _i(y1), _i(x2), _i(y2))
			(x1, y1), (x2, y2) = xy
			return self._gc.DrawRectangle(_i(x1), _i(y1), _i(x2), _i(y2))
		return None

	def ellipse(self, xy, **kw):
		if hasattr(self._gc, 'DrawEllipse'):
			if xy and isinstance(xy[0], (int, float)):
				x1, y1, x2, y2 = xy
				return self._gc.DrawEllipse(_i(x1), _i(y1), _i(x2), _i(y2))
			(x1, y1), (x2, y2) = xy
			return self._gc.DrawEllipse(_i(x1), _i(y1), _i(x2), _i(y2))
		return None

	def profile_snapshot(self):
		return {
			'text_calls': self._text_calls,
			'text_chars': self._text_chars,
			'text_ms': self._text_ns / 1_000_000.0,
		}


class CompatDC:
	"""Wraps wx.DC, coercing float coords to ints.

	No coordinate scaling is done here. When the underlying bitmap has
	SetScaleFactor set, the DC natively maps logical coords to physical
	pixels — pen widths, coordinates, and everything scale automatically.
	PIL drawing (ScaledPILDraw/ScaledFont) handles its own scaling since
	PIL has no concept of bitmap scale factors.

	``antialias=False`` flips the graphics context to ``ANTIALIAS_NONE``
	(and uses ``INTERPOLATION_NONE``) so lines, circles and arcs draw
	pixel-perfect with no edge smoothing — the legacy Wine/GDI look of
	pre-fork Morinus, used by the chart renderers when the user enables
	"Legacy Morinus look" in Appearance → Display.
	"""

	def __init__(self, dc, scale=1.0, antialias=True):
		# Wrap in GCDC so we can control anti-aliasing on the underlying
		# graphics context. Without this wrap macOS wx.DC silently AAs
		# everything via Quartz and we can't turn it off.
		try:
			gcdc = wx.GCDC(dc)
			gc = gcdc.GetGraphicsContext()
			if gc is not None:
				if antialias:
					gc.SetAntialiasMode(wx.ANTIALIAS_DEFAULT)
					gc.SetInterpolationQuality(wx.INTERPOLATION_BEST)
				else:
					# Raw legacy look: no edge smoothing, no bitmap
					# resampling. Single source-pixel per output pixel
					# on every stroke/fill/blit through this DC.
					gc.SetAntialiasMode(wx.ANTIALIAS_NONE)
					gc.SetInterpolationQuality(wx.INTERPOLATION_NONE)
			dc = gcdc
		except Exception:
			pass
		self._dc = dc

	def __getattr__(self, name):
		return getattr(self._dc, name)

	def GetGraphicsContext(self):
		try:
			return self._dc.GetGraphicsContext()
		except Exception:
			return None

	def DrawCircle(self, *args):
		if len(args) == 3:
			x, y, r = args
			return self._dc.DrawCircle(_i(x), _i(y), _i(r))
		if len(args) == 2:
			p, r = args
			x, y = _pt(p)
			return self._dc.DrawCircle(x, y, _i(r))
		return self._dc.DrawCircle(*args)

	def DrawLine(self, *args):
		if len(args) == 4:
			x1, y1, x2, y2 = args
			return self._dc.DrawLine(_i(x1), _i(y1), _i(x2), _i(y2))
		if len(args) == 2:
			p1, p2 = args
			x1, y1 = _pt(p1)
			x2, y2 = _pt(p2)
			return self._dc.DrawLine(x1, y1, x2, y2)
		return self._dc.DrawLine(*args)

	def DrawLineList(self, coords, pens=None):
		fixed = [(_i(x1), _i(y1), _i(x2), _i(y2)) for (x1, y1, x2, y2) in coords]
		return self._dc.DrawLineList(fixed, pens) if pens is not None else self._dc.DrawLineList(fixed)

	def DrawArc(self, x1, y1, x2, y2, xc, yc):
		return self._dc.DrawArc(_i(x1), _i(y1), _i(x2), _i(y2), _i(xc), _i(yc))

	def DrawRectangle(self, x, y, w, h):
		return self._dc.DrawRectangle(_i(x), _i(y), _i(w), _i(h))

	def DrawPoint(self, x, y=None):
		if y is None:
			x, y = _pt(x)
		return self._dc.DrawPoint(_i(x), _i(y))

	def DrawBitmap(self, bmp, x, y, transparent=False):
		return self._dc.DrawBitmap(bmp, _i(x), _i(y), transparent)

	def DrawText(self, text, x, y):
		return self._dc.DrawText(text, _i(x), _i(y))

	def DrawRotatedText(self, text, x, y, angle):
		return self._dc.DrawRotatedText(text, _i(x), _i(y), angle)


class DCPILDraw:
	"""PIL-like draw interface backed by wx.DC for direct-to-screen rendering.

	Provides text(), textsize(), line(), rectangle() matching the API used by
	ScaledPILDraw so existing drawline() code works unchanged.  No PIL image
	is created — drawing goes straight to the DC (viewport-clipped by wx).
	"""

	def __init__(self, dc):
		self._dc = dc
		self._pen_cache = {}

	def _pen(self, fill, width=1):
		key = (fill, width) if isinstance(fill, tuple) else (id(fill), width)
		p = self._pen_cache.get(key)
		if p is None:
			p = wx.Pen(_to_colour(fill), max(1, _i(width)))
			self._pen_cache[key] = p
		return p

	def text(self, xy, text, fill=None, font=None, **kw):
		if font is None or not text:
			return
		wxfont = getattr(font, 'wxfont', font)
		self._dc.SetFont(wxfont)
		self._dc.SetTextForeground(_to_colour(fill))
		self._dc.DrawText(str(text), _i(xy[0]), _i(xy[1]))

	def textsize(self, text, font=None, *args, **kw):
		if font is None or not text:
			return (0, 0)
		return font.getsize(str(text))

	def line(self, xy, fill=None, width=1, **kw):
		self._dc.SetPen(self._pen(fill, width))
		if xy and isinstance(xy[0], (int, float)):
			x1, y1, x2, y2 = xy[0], xy[1], xy[2], xy[3]
		else:
			(x1, y1), (x2, y2) = xy[0], xy[1]
		self._dc.DrawLine(_i(x1), _i(y1), _i(x2), _i(y2))

	def rectangle(self, xy, fill=None, outline=None, width=1, **kw):
		if xy and isinstance(xy[0], (int, float)):
			x1, y1, x2, y2 = xy[0], xy[1], xy[2], xy[3]
		else:
			(x1, y1), (x2, y2) = xy[0], xy[1]
		if fill is not None:
			self._dc.SetBrush(wx.Brush(_to_colour(fill)))
			self._dc.SetPen(wx.TRANSPARENT_PEN)
			self._dc.DrawRectangle(_i(x1), _i(y1), _i(x2 - x1), _i(y2 - y1))
		if outline is not None:
			self._dc.SetPen(self._pen(outline, width))
			self._dc.SetBrush(wx.TRANSPARENT_BRUSH)
			self._dc.DrawRectangle(_i(x1), _i(y1), _i(x2 - x1), _i(y2 - y1))

	def polygon(self, xy, fill=None, outline=None, width=1, **kw):
		points = [wx.Point(_i(x), _i(y)) for x, y in xy]
		self._dc.SetBrush(wx.Brush(_to_colour(fill)) if fill is not None else wx.TRANSPARENT_BRUSH)
		self._dc.SetPen(self._pen(outline, width) if outline is not None else wx.TRANSPARENT_PEN)
		self._dc.DrawPolygon(points)
